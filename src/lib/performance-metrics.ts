import type { GrowthPoint } from "./dashboard-metrics.ts";
import { outreachRates } from "./outreach-rates.ts";

/**
 * Performance section (dashboard) — the CAM-facing read of "how are we doing".
 *
 * Every number here is computed from tables that already exist and that every
 * role can already read (matrix §3.4, §3.1, §3.6):
 *
 *   emails sent   → OUTREACH_MESSAGES (send_status = 'sent', sent_at, sent_by_user_id)
 *   replies       → REPLY_EVENTS (received_at), attributed to the sender of the
 *                   OUTREACH_MESSAGES row it answers. Unmatched replies (no
 *                   message — the Gmail sync could not pair them) are counted
 *                   team-wide only; they cannot be attributed to a person.
 *   conversions   → OUTCOMES (outcome_type = 'converted', recorded_by_user_id)
 *   orgs scored   → LATEST_SCORES (scored_at). Scoring is system-run (service
 *                   role upserts, F088), so this one metric has no per-person
 *                   attribution — it is always team-wide.
 *
 * PIPELINE_METRICS / SECTOR_PERFORMANCE (data-model tab 09) do not exist as
 * tables yet, so their definitions are computed here from the raw events over
 * the trailing window instead of a rollup table. When the rollups land, the
 * fetch half of this module swaps to reading them and the pure functions below
 * become the verification oracle.
 */

// ---------------------------------------------------------------------------
// Week windows
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** The trend and sector windows both read the trailing 90 days. */
export const PERFORMANCE_TREND_DAYS = 90;

/**
 * The instant the page's event fetches must reach back to for a `days`-long
 * trend window — UTC-midnight aligned, the same alignment the series builders
 * use, so a fetched edge event is never silently dropped.
 */
export function trendWindowStart(now: Date, days = PERFORMANCE_TREND_DAYS): Date {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(end - (days - 1) * DAY_MS);
}

export type DayWindow = { start: number; end: number };

/**
 * "This week vs last week" in calendar terms, not trailing-7-day terms: a
 * Monday-start ISO week (UTC), so everyone on the team compares the same
 * blocks. `end` is exclusive (the next Monday's midnight), so a `gte start,
 * lt end` filter is exact and overlapping-free.
 */
export function weekWindows(now: Date): { thisWeek: DayWindow; lastWeek: DayWindow } {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // getUTCDay(): 0 = Sunday … 6 = Saturday. Monday-start offset: Sunday rolls
  // back 6 days into the same ISO week, every other day backs up (day − 1).
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const thisWeekStart = utcMidnight - daysSinceMonday * DAY_MS;
  return {
    thisWeek: { start: thisWeekStart, end: thisWeekStart + 7 * DAY_MS },
    lastWeek: { start: thisWeekStart - 7 * DAY_MS, end: thisWeekStart },
  };
}

/** YYYY-MM-DD in UTC — the same string the `from`/`to` period picker emits. */
export function isoDayUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Totally arbitrary period `from` → `to` (both inclusive ISO days, UTC) and its
 * immediately preceding period of identical length, for “this period vs prior
 * period” tiles. Both windows are `[start, end)` half-open on midnight UTC.
 */
export function periodWindows(fromISO: string, toISO: string): {
  thisPeriod: DayWindow;
  priorPeriod: DayWindow;
} {
  const fromMs = Date.parse(`${fromISO}T00:00:00Z`);
  const toMs = Date.parse(`${toISO}T00:00:00Z`);
  const thisStart = fromMs;
  const thisEnd = toMs + DAY_MS; // exclusive next midnight
  const duration = thisEnd - thisStart;
  return {
    thisPeriod: { start: thisStart, end: thisEnd },
    priorPeriod: { start: thisStart - duration, end: thisStart },
  };
}

const inWindow = (iso: string | null | undefined, window: DayWindow): boolean => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= window.start && t < window.end;
};

// ---------------------------------------------------------------------------
// Raw rows (what the page fetches)
// ---------------------------------------------------------------------------

export type SentMessageRow = {
  id: string;
  sent_at: string | null;
  sent_by_user_id: string | null;
  organisation_id: string;
};

export type ReplyEventRow = {
  id: string;
  received_at: string;
  outreach_message_id: string | null;
  organisation_id: string;
};

export type ConvertedOutcomeRow = {
  id: string;
  created_at: string;
  recorded_by_user_id: string | null;
  organisation_id: string;
};

export type LatestScoreRow = {
  organisation_id: string;
  priority_band: string | null;
  priority_score: number | null;
  scored_at: string;
};

export type TeamUserRow = {
  id: string;
  full_name: string | null;
  role: string;
  /**
   * Optional because nothing in this module reads them — they are here so the
   * dashboard's one `users` read can also feed the user hover card, rather than
   * the card being handed placeholder values (which is how it came to display
   * an empty email and "last active: Never" for the whole team).
   */
  email?: string | null;
  last_seen_at?: string | null;
  is_active?: boolean | null;
};

export type PerformanceInput = {
  messages: SentMessageRow[];
  replies: ReplyEventRow[];
  conversions: ConvertedOutcomeRow[];
  scores: LatestScoreRow[];
  users: TeamUserRow[];
};

// ---------------------------------------------------------------------------
// Weekly activity — the four tiles
// ---------------------------------------------------------------------------

export type WeeklyCount = { thisWeek: number; lastWeek: number };

export type PersonWeekly = {
  userId: string;
  name: string;
  /** Events, not clients: three emails to one charity are three of these. */
  emailsSent: WeeklyCount;
  replies: WeeklyCount;
  conversions: WeeklyCount;
  /**
   * The current window's client funnel — distinct clients emailed, replied,
   * converted — and the two rates built from it (`lib/outreach-rates.ts`).
   *
   * Current window only, unlike the event counts above: the leaderboard asks
   * "where does this person stand now", and a prior-window rate that nothing
   * reads would be one more number to keep true.
   */
  contactedClients: number;
  repliedClients: number;
  respondedClients: number;
  convertedClients: number;
  replyRate: number | null;
  winRate: number | null;
};

export type PerformanceSummary = {
  /**
   * Team totals — every attributed event on the platform, plus the same
   * current-window funnel the per-person rows carry, so the leaderboard's
   * "Team" footer row is the team's own reply and win rate rather than a
   * message-based rate that disagrees with the rows above it.
   */
  team: {
    emailsSent: WeeklyCount;
    replies: WeeklyCount;
    conversions: WeeklyCount;
    contactedClients: number;
    repliedClients: number;
    respondedClients: number;
    convertedClients: number;
    replyRate: number | null;
    winRate: number | null;
  };
  /** Per-person rollups, keyed by user id. Users with no activity are absent. */
  people: Map<string, PersonWeekly>;
  /** Team-wide only: scoring runs system-wide, so nobody "owns" a score. */
  orgsScored: WeeklyCount;
};

/**
 * Every rollup both public functions below need, for whichever pair of windows
 * the caller picked.
 *
 * One implementation on purpose. These two functions used to be the same loops
 * written twice — which is exactly how "conversion rate" came to mean one thing
 * on the leaderboard and another on the sector table. A change to how an event
 * is attributed, or to how a rate is built, now cannot land on one screen and
 * miss the other.
 */
function rollUp(
  input: PerformanceInput,
  current: DayWindow,
  prior: DayWindow,
): PerformanceSummary {
  const senderByMessage = new Map<string, string>();
  for (const message of input.messages) {
    if (message.sent_by_user_id) senderByMessage.set(message.id, message.sent_by_user_id);
  }

  const nameByUser = new Map(input.users.map((user) => [user.id, user.full_name]));

  const team = {
    emailsSent: { thisWeek: 0, lastWeek: 0 },
    replies: { thisWeek: 0, lastWeek: 0 },
    conversions: { thisWeek: 0, lastWeek: 0 },
    contactedClients: 0,
    repliedClients: 0,
    respondedClients: 0,
    convertedClients: 0,
    replyRate: null as number | null,
    winRate: null as number | null,
  };
  const people = new Map<string, PersonWeekly>();

  /**
   * The current window's client ids per person, kept as sets because the two
   * rates are ratios of clients and win rate's denominator is a union. Built
   * beside the event counts rather than derived from them: three emails to one
   * charity are three events and one contacted client.
   */
  const clientSets = new Map<
    string,
    { contacted: Set<string>; replied: Set<string>; converted: Set<string> }
  >();
  /** The same three sets for the whole team — the leaderboard's footer row. */
  const teamClients = { contacted: new Set<string>(), replied: new Set<string>(), converted: new Set<string>() };
  const clientSetsFor = (userId: string) => {
    let sets = clientSets.get(userId);
    if (!sets) {
      sets = { contacted: new Set(), replied: new Set(), converted: new Set() };
      clientSets.set(userId, sets);
    }
    return sets;
  };

  const bump = (
    userId: string,
    key: "emailsSent" | "replies" | "conversions",
    week: "thisWeek" | "lastWeek",
  ) => {
    team[key][week] += 1;
    let person = people.get(userId);
    if (!person) {
      person = {
        userId,
        name: nameByUser.get(userId) ?? "Unknown",
        emailsSent: { thisWeek: 0, lastWeek: 0 },
        replies: { thisWeek: 0, lastWeek: 0 },
        conversions: { thisWeek: 0, lastWeek: 0 },
        contactedClients: 0,
        repliedClients: 0,
        respondedClients: 0,
        convertedClients: 0,
        replyRate: null,
        winRate: null,
      };
      people.set(userId, person);
    }
    person[key][week] += 1;
  };

  for (const message of input.messages) {
    if (!message.sent_by_user_id) continue;
    if (inWindow(message.sent_at, current)) {
      bump(message.sent_by_user_id, "emailsSent", "thisWeek");
      clientSetsFor(message.sent_by_user_id).contacted.add(message.organisation_id);
      teamClients.contacted.add(message.organisation_id);
    } else if (inWindow(message.sent_at, prior)) {
      bump(message.sent_by_user_id, "emailsSent", "lastWeek");
    }
  }
  for (const reply of input.replies) {
    if (!reply.outreach_message_id) continue;
    const sender = senderByMessage.get(reply.outreach_message_id);
    if (!sender) continue;
    if (inWindow(reply.received_at, current)) {
      bump(sender, "replies", "thisWeek");
      clientSetsFor(sender).replied.add(reply.organisation_id);
      teamClients.replied.add(reply.organisation_id);
    } else if (inWindow(reply.received_at, prior)) {
      bump(sender, "replies", "lastWeek");
    }
  }
  for (const conversion of input.conversions) {
    if (!conversion.recorded_by_user_id) continue;
    if (inWindow(conversion.created_at, current)) {
      bump(conversion.recorded_by_user_id, "conversions", "thisWeek");
      clientSetsFor(conversion.recorded_by_user_id).converted.add(conversion.organisation_id);
      teamClients.converted.add(conversion.organisation_id);
    } else if (inWindow(conversion.created_at, prior)) {
      bump(conversion.recorded_by_user_id, "conversions", "lastWeek");
    }
  }

  const teamRates = outreachRates(teamClients);
  team.contactedClients = teamRates.contactedClients;
  team.repliedClients = teamRates.repliedClients;
  team.respondedClients = teamRates.respondedClients;
  team.convertedClients = teamRates.convertedClients;
  team.replyRate = teamRates.replyRate;
  team.winRate = teamRates.winRate;

  for (const [userId, person] of people) {
    const rates = outreachRates(clientSetsFor(userId));
    person.contactedClients = rates.contactedClients;
    person.repliedClients = rates.repliedClients;
    person.respondedClients = rates.respondedClients;
    person.convertedClients = rates.convertedClients;
    person.replyRate = rates.replyRate;
    person.winRate = rates.winRate;
  }

  const orgsScored = { thisWeek: 0, lastWeek: 0 };
  for (const score of input.scores) {
    if (inWindow(score.scored_at, current)) orgsScored.thisWeek += 1;
    else if (inWindow(score.scored_at, prior)) orgsScored.lastWeek += 1;
  }

  return { team, people, orgsScored };
}

/** The fixed ISO week's numbers — see `rollUp` for what is in them. */
export function computePerformance(
  input: PerformanceInput,
  now: Date = new Date(),
): PerformanceSummary {
  const windows = weekWindows(now);
  return rollUp(input, windows.thisWeek, windows.lastWeek);
}

/**
 * Totally arbitrary period (from→to inclusive ISO days, UTC) — same shape as
 * `computePerformance` but “this week vs last week” becomes “this period vs
 * prior period” of identical length. Used when the dashboard’s Performance
 * tiles are driven by a user-picked range (7/30/90/custom) instead of the
 * fixed ISO week.
 */
export function performanceForPeriod(
  input: PerformanceInput,
  fromISO: string,
  toISO: string,
): PerformanceSummary {
  const { thisPeriod, priorPeriod } = periodWindows(fromISO, toISO);
  return rollUp(input, thisPeriod, priorPeriod);
}

/**
 * The slice of a `PerformanceInput` the browser actually needs.
 *
 * The Performance section re-derives its tiles client-side when a period is
 * picked, so the input is serialised into the page. `scores` has a row for every
 * scored organisation and `sectorByOrg` an entry for every organisation — on
 * staging that was ~450 KB of a 735 KB dashboard — yet on the client:
 *
 * - `performanceForPeriod` and `bucketCountsForPeriod` read only a score's
 *   `scored_at` (the orgs-scored counts), and
 * - `sectorPerformance` builds sectors only from organisations with a message,
 *   reply or conversion in the input — but it averages the
 *   score of *every* organisation in such a sector, contacted or not.
 *
 * So a score keeps its full row only when its organisation's sector has
 * activity; every other score keeps its `scored_at` and nothing else (a null
 * score is skipped by `sectorPerformance`). The sector map keeps the
 * organisations those full rows and the activity refer to. Both functions
 * return the same result for the trimmed input as for the original — the test
 * pins that.
 */
export function performanceInputForClient(
  input: PerformanceInput,
  sectorByOrg: Map<string, string | null>,
): { raw: PerformanceInput; sectorByOrg: Map<string, string | null> } {
  const sectorOf = (organisationId: string) => sectorByOrg.get(organisationId) ?? UNKNOWN_SECTOR;

  const active = new Set<string>();
  for (const message of input.messages) active.add(message.organisation_id);
  for (const reply of input.replies) active.add(reply.organisation_id);
  for (const conversion of input.conversions) active.add(conversion.organisation_id);
  const activeSectors = new Set([...active].map(sectorOf));

  const kept = new Set(active);
  const scores = input.scores.map((score) => {
    if (score.priority_score !== null && activeSectors.has(sectorOf(score.organisation_id))) {
      kept.add(score.organisation_id);
      return score;
    }
    return { organisation_id: "", priority_band: null, priority_score: null, scored_at: score.scored_at };
  });

  const sectors = new Map<string, string | null>();
  for (const id of kept) {
    if (sectorByOrg.has(id)) sectors.set(id, sectorByOrg.get(id) ?? null);
  }

  return { raw: { ...input, scores }, sectorByOrg: sectors };
}

/** A named person's rollup for the picker's display, or undefined. */
export function personFor(summary: PerformanceSummary, userId: string): PersonWeekly | undefined {
  return summary.people.get(userId);
}

// ---------------------------------------------------------------------------
// Pipeline trend — PIPELINE_METRICS' definition over the trailing window
// ---------------------------------------------------------------------------

const dayKey = (iso: string) => iso.slice(0, 10);

/**
 * PIPELINE_METRICS (tab 09) as a daily series computed from raw events:
 * for each day, the *cumulative* counts of organisations contacted (≥1 sent
 * email), replied, and converted inside the fetched window, and the rate
 * converted ÷ contacted. A day with no contacts yet scores 0 rather than
 * dividing by zero.
 *
 * Window-scoped, not all-history: contacts made before the fetched window are
 * not in these denominators, so early points can read lower than the platform's
 * real lifetime rate. That is the honest price of computing the rollup without
 * the PIPELINE_METRICS table; the curve's *shape* — the thing a trend is for —
 * is unaffected.
 */
export function pipelineTrendSeries(
  input: Pick<PerformanceInput, "messages" | "replies" | "conversions">,
  days = PERFORMANCE_TREND_DAYS,
  now: Date = new Date(),
  filterUserId?: string,
): GrowthPoint[] {
  if (days < 1) return [];

  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (days - 1) * DAY_MS;

  const senderByMessage = new Map<string, string>();
  for (const message of input.messages) {
    if (message.sent_by_user_id) senderByMessage.set(message.id, message.sent_by_user_id);
  }

  const contactedByDay = new Map<string, Set<string>>();
  const repliedByDay = new Map<string, Set<string>>();
  const convertedByDay = new Map<string, Set<string>>();

  const record = (
    map: Map<string, Set<string>>,
    iso: string | null,
    organisationId: string,
  ) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (Number.isNaN(t) || t < start || t > end) return;
    const key = dayKey(new Date(t).toISOString());
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(organisationId);
  };

  for (const message of input.messages) {
    if (filterUserId && message.sent_by_user_id !== filterUserId) continue;
    if (message.sent_at) record(contactedByDay, message.sent_at, message.organisation_id);
  }
  for (const reply of input.replies) {
    if (filterUserId) {
      const sender = reply.outreach_message_id ? senderByMessage.get(reply.outreach_message_id) : null;
      if (sender !== filterUserId) continue;
    }
    record(repliedByDay, reply.received_at, reply.organisation_id);
  }
  for (const conversion of input.conversions) {
    if (filterUserId && conversion.recorded_by_user_id !== filterUserId) continue;
    record(convertedByDay, conversion.created_at, conversion.organisation_id);
  }

  const contacted = new Set<string>();
  const converted = new Set<string>();

  const points: GrowthPoint[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const key = dayKey(new Date(ms).toISOString());
    for (const orgId of contactedByDay.get(key) ?? []) contacted.add(orgId);
    for (const orgId of convertedByDay.get(key) ?? []) converted.add(orgId);
    const rate = contacted.size > 0 ? converted.size / contacted.size : 0;
    points.push({ value: rate, date: key });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Funnel trend — daily client counts for the dashboard's three-line chart
// ---------------------------------------------------------------------------

/** The funnel chart reads a full year so its custom range can reach back past 90 days. */
export const FUNNEL_TREND_DAYS = 365;

export type FunnelTrendSeries = {
  /** Distinct organisations emailed per day. */
  contacted: GrowthPoint[];
  /** Distinct organisations replying per day — clients, not replies. */
  replied: GrowthPoint[];
  /** Distinct organisations converting per day. */
  converted: GrowthPoint[];
};

/**
 * The three lines of the dashboard's funnel chart: per day, how many distinct
 * organisations were contacted, replied, and converted.
 *
 * Daily counts, not cumulative — a cumulative curve only ever climbs, which
 * hides whether this month is better than last. An organisation emailed twice
 * in one day counts once; emailed on two days counts on both. Same UTC-day
 * bucketing as `pipelineTrendSeries`, and team-wide like the conversion-rate
 * trend it replaces (the scope picker re-derives the tiles, not this chart).
 *
 * Takes the narrow rows the dashboard's funnel reads select (organisation and
 * date only), so a year of events stays a small payload.
 */
export function funnelTrendSeries(
  input: {
    messages: readonly { organisation_id: string; sent_at: string | null }[];
    replies: readonly { organisation_id: string; received_at: string }[];
    conversions: readonly { organisation_id: string; created_at: string }[];
  },
  days = FUNNEL_TREND_DAYS,
  now: Date = new Date(),
): FunnelTrendSeries {
  const empty = (): FunnelTrendSeries => ({ contacted: [], replied: [], converted: [] });
  if (days < 1) return empty();

  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (days - 1) * DAY_MS;

  const contactedByDay = new Map<string, Set<string>>();
  const repliedByDay = new Map<string, Set<string>>();
  const convertedByDay = new Map<string, Set<string>>();

  const record = (
    map: Map<string, Set<string>>,
    iso: string | null,
    organisationId: string,
  ) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (Number.isNaN(t) || t < start || t > end) return;
    const key = dayKey(new Date(t).toISOString());
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(organisationId);
  };

  for (const message of input.messages) {
    record(contactedByDay, message.sent_at, message.organisation_id);
  }
  for (const reply of input.replies) {
    record(repliedByDay, reply.received_at, reply.organisation_id);
  }
  for (const conversion of input.conversions) {
    record(convertedByDay, conversion.created_at, conversion.organisation_id);
  }

  const contacted: GrowthPoint[] = [];
  const replied: GrowthPoint[] = [];
  const converted: GrowthPoint[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const key = dayKey(new Date(ms).toISOString());
    contacted.push({ value: contactedByDay.get(key)?.size ?? 0, date: key });
    replied.push({ value: repliedByDay.get(key)?.size ?? 0, date: key });
    converted.push({ value: convertedByDay.get(key)?.size ?? 0, date: key });
  }
  return { contacted, replied, converted };
}

// ---------------------------------------------------------------------------
// Sector performance — SECTOR_PERFORMANCE's definition over the window
// ---------------------------------------------------------------------------

export type SectorPerformanceRow = {
  sector: string;
  orgsContacted: number;
  emailsSent: number;
  replies: number;
  /** Replied clients ÷ contacted clients; null when nobody was contacted. */
  replyRate: number | null;
  /** Converted clients ÷ responded clients (replied ∪ converted). */
  winRate: number | null;
  avgPriorityScore: number | null;
};

const UNKNOWN_SECTOR = "Unknown sector";

/**
 * SECTOR_PERFORMANCE (tab 09) computed per sector over the trailing window:
 * distinct organisations emailed, replies received, the two shared rates
 * (`lib/outreach-rates.ts`) and the mean current priority score across those
 * orgs — the last one is the "does SCOUT predict outcomes" check.
 *
 * Rates are per client, not per email: this row used to divide replied clients
 * by emails sent (four follow-ups to one silent charity read as activity) while
 * every other screen divided by clients.
 *
 * Supports optional `filterUserId` to filter by individual CAM or whole team.
 * `sectorByOrg` comes from the organisations rows the dashboard already loads.
 */
export function sectorPerformance(
  input: Pick<PerformanceInput, "messages" | "replies" | "conversions" | "scores">,
  sectorByOrg: Map<string, string | null>,
  days = PERFORMANCE_TREND_DAYS,
  now: Date = new Date(),
  filterUserId?: string,
): SectorPerformanceRow[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (days - 1) * DAY_MS;
  const inTrend = (iso: string | null) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t >= start && t <= end;
  };

  const senderByMessage = new Map<string, string>();
  for (const message of input.messages) {
    if (message.sent_by_user_id) senderByMessage.set(message.id, message.sent_by_user_id);
  }

  type Acc = {
    orgs: Set<string>;
    emails: number;
    repliedOrgs: Set<string>;
    convertedOrgs: Set<string>;
    scoreSum: number;
    scoreCount: number;
  };
  const bySector = new Map<string, Acc>();
  const accFor = (sector: string): Acc => {
    let acc = bySector.get(sector);
    if (!acc) {
      acc = { orgs: new Set(), emails: 0, repliedOrgs: new Set(), convertedOrgs: new Set(), scoreSum: 0, scoreCount: 0 };
      bySector.set(sector, acc);
    }
    return acc;
  };

  for (const message of input.messages) {
    if (!inTrend(message.sent_at)) continue;
    if (filterUserId && message.sent_by_user_id !== filterUserId) continue;
    const sector = sectorByOrg.get(message.organisation_id) ?? null;
    const acc = accFor(sector ?? UNKNOWN_SECTOR);
    acc.emails += 1;
    acc.orgs.add(message.organisation_id);
  }
  for (const reply of input.replies) {
    if (!inTrend(reply.received_at)) continue;
    if (filterUserId) {
      const sender = reply.outreach_message_id ? senderByMessage.get(reply.outreach_message_id) : null;
      if (sender !== filterUserId) continue;
    }
    const sector = sectorByOrg.get(reply.organisation_id) ?? null;
    accFor(sector ?? UNKNOWN_SECTOR).repliedOrgs.add(reply.organisation_id);
  }
  for (const conversion of input.conversions) {
    if (!inTrend(conversion.created_at)) continue;
    if (filterUserId && conversion.recorded_by_user_id !== filterUserId) continue;
    const sector = sectorByOrg.get(conversion.organisation_id) ?? null;
    accFor(sector ?? UNKNOWN_SECTOR).convertedOrgs.add(conversion.organisation_id);
  }
  for (const score of input.scores) {
    if (score.priority_score === null) continue;
    const sector = sectorByOrg.get(score.organisation_id) ?? null;
    if (!bySector.has(sector ?? UNKNOWN_SECTOR)) continue;
    const acc = accFor(sector ?? UNKNOWN_SECTOR);
    acc.scoreSum += score.priority_score;
    acc.scoreCount += 1;
  }

  const rows: SectorPerformanceRow[] = [];
  for (const [sector, acc] of bySector) {
    const rates = outreachRates({
      contacted: acc.orgs,
      replied: acc.repliedOrgs,
      converted: acc.convertedOrgs,
    });
    rows.push({
      sector,
      orgsContacted: rates.contactedClients,
      emailsSent: acc.emails,
      replies: rates.repliedClients,
      replyRate: rates.replyRate,
      winRate: rates.winRate,
      avgPriorityScore: acc.scoreCount > 0 ? acc.scoreSum / acc.scoreCount : null,
    });
  }
  // Where outreach actually works, first; ties break by volume. A sector with
  // no replies yet has no win rate at all — sorted last, never as 0%, which
  // would rank it with a sector that tried and won nothing.
  rows.sort(
    (a, b) =>
      (b.winRate ?? -1) - (a.winRate ?? -1) ||
      b.orgsContacted - a.orgsContacted ||
      a.sector.localeCompare(b.sector),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Queue quality — LATEST_SCORES band distribution
// ---------------------------------------------------------------------------

export type QueueBands = { high: number; medium: number; low: number };

/**
 * Band counts across every scored organisation (LATEST_SCORES is read-all,
 * matrix §3.6). Rows whose band is null (scored but unbanded — the paired
 * check constraint makes that impossible today, but the count is defensive)
 * are excluded from all three bands; `scored` counts every row with a band.
 */
export function queueBands(scores: LatestScoreRow[]): { bands: QueueBands; scored: number } {
  const bands: QueueBands = { high: 0, medium: 0, low: 0 };
  let scored = 0;
  for (const score of scores) {
    if (score.priority_band === "high") {
      bands.high += 1;
      scored += 1;
    } else if (score.priority_band === "medium") {
      bands.medium += 1;
      scored += 1;
    } else if (score.priority_band === "low") {
      bands.low += 1;
      scored += 1;
    }
  }
  return { bands, scored };
}

// ---------------------------------------------------------------------------
// 7-Quadrant Period Subdivision & Counts
// ---------------------------------------------------------------------------

export type PerformanceBucket = {
  index: number;
  startMs: number;
  endMs: number;
  dateNumber: string;
  shortLabel: string;
};

/**
 * Divides an arbitrary [fromISO, toISO] date range into 7 sequential buckets
 * (quadrants) for the 7-bar chart.
 * - For <= 7 days: 1 day per bar up to totalDays, starting on fromISO.
 * - For > 7 days (e.g. 30 or 90 days): divides totalDays into 7 equal intervals,
 *   starting at day 0 (fromISO) and stepping through to toISO.
 */
export function createPeriodBuckets(fromISO: string, toISO: string): PerformanceBucket[] {
  const startMs = Date.parse(`${fromISO}T00:00:00Z`);
  const toDayStartMs = Date.parse(`${toISO}T00:00:00Z`);
  const totalDays = Math.max(1, Math.round((toDayStartMs - startMs) / DAY_MS) + 1);

  const buckets: PerformanceBucket[] = [];

  if (totalDays <= 7) {
    for (let i = 0; i < 7; i++) {
      const bStartMs = startMs + i * DAY_MS;
      const bEndMs = bStartMs + DAY_MS;
      const d = new Date(bStartMs);
      const dayNum = d.getUTCDate().toString();
      const monthShort = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      buckets.push({
        index: i,
        startMs: bStartMs,
        endMs: bEndMs,
        dateNumber: dayNum,
        shortLabel: `${monthShort} ${dayNum}`,
      });
    }
    return buckets;
  }

  const step = totalDays / 7;
  for (let i = 0; i < 7; i++) {
    const startDayOffset = Math.round(i * step);
    const endDayOffset =
      i === 6 ? totalDays - 1 : Math.min(totalDays - 1, Math.round((i + 1) * step) - 1);

    const bStartMs = startMs + startDayOffset * DAY_MS;
    const bEndMs = startMs + (endDayOffset + 1) * DAY_MS;

    const bStart = new Date(bStartMs);
    const bEnd = new Date(startMs + endDayOffset * DAY_MS);

    const startDay = bStart.getUTCDate().toString();
    const startMonth = bStart.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const endDay = bEnd.getUTCDate().toString();
    const endMonth = bEnd.toLocaleString("en-US", { month: "short", timeZone: "UTC" });

    const shortLabel =
      startDayOffset === endDayOffset
        ? `${startMonth} ${startDay}`
        : startMonth === endMonth
          ? `${startMonth} ${startDay}–${endDay}`
          : `${startMonth} ${startDay} – ${endMonth} ${endDay}`;

    buckets.push({
      index: i,
      startMs: bStartMs,
      endMs: bEndMs,
      dateNumber: startDay,
      shortLabel,
    });
  }

  return buckets;
}

export function bucketCountsForPeriod(
  input: PerformanceInput,
  buckets: PerformanceBucket[],
  userId?: string | null,
): {
  emails: number[];
  replies: number[];
  conversions: number[];
  scores: number[];
} {
  const emails = [0, 0, 0, 0, 0, 0, 0];
  const replies = [0, 0, 0, 0, 0, 0, 0];
  const conversions = [0, 0, 0, 0, 0, 0, 0];
  const scores = [0, 0, 0, 0, 0, 0, 0];

  const findBucketIndex = (timestamp: string | null | undefined): number => {
    if (!timestamp) return -1;
    const ms = Date.parse(timestamp);
    if (Number.isNaN(ms)) return -1;
    for (let i = 0; i < buckets.length; i++) {
      if (ms >= buckets[i].startMs && ms < buckets[i].endMs) {
        return i;
      }
    }
    return -1;
  };

  const senderByMessage = new Map<string, string>();
  for (const message of input.messages) {
    if (message.sent_by_user_id) senderByMessage.set(message.id, message.sent_by_user_id);
    if (userId && message.sent_by_user_id !== userId) continue;
    const idx = findBucketIndex(message.sent_at);
    if (idx >= 0) emails[idx] += 1;
  }

  for (const reply of input.replies) {
    if (!reply.outreach_message_id) continue;
    const sender = senderByMessage.get(reply.outreach_message_id);
    if (userId && sender !== userId) continue;
    const idx = findBucketIndex(reply.received_at);
    if (idx >= 0) replies[idx] += 1;
  }

  for (const conversion of input.conversions) {
    if (userId && conversion.recorded_by_user_id !== userId) continue;
    const idx = findBucketIndex(conversion.created_at);
    if (idx >= 0) conversions[idx] += 1;
  }

  for (const score of input.scores) {
    const idx = findBucketIndex(score.scored_at);
    if (idx >= 0) scores[idx] += 1;
  }

  return { emails, replies, conversions, scores };
}
