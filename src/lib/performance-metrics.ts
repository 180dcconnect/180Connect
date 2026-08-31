import type { GrowthPoint } from "./dashboard-metrics.ts";

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

export type TeamUserRow = { id: string; full_name: string | null; role: string };

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
  emailsSent: WeeklyCount;
  replies: WeeklyCount;
  conversions: WeeklyCount;
};

export type PerformanceSummary = {
  /** Team totals — every attributed event on the platform. */
  team: { emailsSent: WeeklyCount; replies: WeeklyCount; conversions: WeeklyCount };
  /** Per-person rollups, keyed by user id. Users with no activity are absent. */
  people: Map<string, PersonWeekly>;
  /** Team-wide only: scoring runs system-wide, so nobody "owns" a score. */
  orgsScored: WeeklyCount;
};

export function computePerformance(
  input: PerformanceInput,
  now: Date = new Date(),
): PerformanceSummary {
  const windows = weekWindows(now);

  const senderByMessage = new Map<string, string>();
  for (const message of input.messages) {
    if (message.sent_by_user_id) senderByMessage.set(message.id, message.sent_by_user_id);
  }

  const nameByUser = new Map(input.users.map((user) => [user.id, user.full_name]));

  const team = {
    emailsSent: { thisWeek: 0, lastWeek: 0 },
    replies: { thisWeek: 0, lastWeek: 0 },
    conversions: { thisWeek: 0, lastWeek: 0 },
  };
  const people = new Map<string, PersonWeekly>();

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
      };
      people.set(userId, person);
    }
    person[key][week] += 1;
  };

  for (const message of input.messages) {
    if (!message.sent_by_user_id) continue;
    if (inWindow(message.sent_at, windows.thisWeek)) bump(message.sent_by_user_id, "emailsSent", "thisWeek");
    else if (inWindow(message.sent_at, windows.lastWeek)) bump(message.sent_by_user_id, "emailsSent", "lastWeek");
  }
  for (const reply of input.replies) {
    if (!reply.outreach_message_id) continue;
    const sender = senderByMessage.get(reply.outreach_message_id);
    if (!sender) continue;
    if (inWindow(reply.received_at, windows.thisWeek)) bump(sender, "replies", "thisWeek");
    else if (inWindow(reply.received_at, windows.lastWeek)) bump(sender, "replies", "lastWeek");
  }
  for (const conversion of input.conversions) {
    if (!conversion.recorded_by_user_id) continue;
    if (inWindow(conversion.created_at, windows.thisWeek)) bump(conversion.recorded_by_user_id, "conversions", "thisWeek");
    else if (inWindow(conversion.created_at, windows.lastWeek)) bump(conversion.recorded_by_user_id, "conversions", "lastWeek");
  }

  const orgsScored = { thisWeek: 0, lastWeek: 0 };
  for (const score of input.scores) {
    if (inWindow(score.scored_at, windows.thisWeek)) orgsScored.thisWeek += 1;
    else if (inWindow(score.scored_at, windows.lastWeek)) orgsScored.lastWeek += 1;
  }

  return { team, people, orgsScored };
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
): GrowthPoint[] {
  if (days < 1) return [];

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
    if (message.sent_at) record(contactedByDay, message.sent_at, message.organisation_id);
  }
  for (const reply of input.replies) {
    record(repliedByDay, reply.received_at, reply.organisation_id);
  }
  for (const conversion of input.conversions) {
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
// Sector performance — SECTOR_PERFORMANCE's definition over the window
// ---------------------------------------------------------------------------

export type SectorPerformanceRow = {
  sector: string;
  orgsContacted: number;
  emailsSent: number;
  replies: number;
  replyRate: number;
  conversionRate: number;
  avgPriorityScore: number | null;
};

const UNKNOWN_SECTOR = "Unknown sector";

/**
 * SECTOR_PERFORMANCE (tab 09) computed per sector over the trailing window:
 * distinct organisations emailed, replies received, reply rate (replies ÷
 * emails sent), conversion rate (distinct converted orgs ÷ distinct contacted
 * orgs), and the mean current priority score across those orgs — the last one
 * is the "does SCOUT predict outcomes" check.
 *
 * `sectorByOrg` comes from the organisations rows the dashboard already loads.
 */
export function sectorPerformance(
  input: Pick<PerformanceInput, "messages" | "replies" | "conversions" | "scores">,
  sectorByOrg: Map<string, string | null>,
  days = PERFORMANCE_TREND_DAYS,
  now: Date = new Date(),
): SectorPerformanceRow[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (days - 1) * DAY_MS;
  const inTrend = (iso: string | null) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t >= start && t <= end;
  };

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
    const sector = sectorByOrg.get(message.organisation_id) ?? null;
    const acc = accFor(sector ?? UNKNOWN_SECTOR);
    acc.emails += 1;
    acc.orgs.add(message.organisation_id);
  }
  for (const reply of input.replies) {
    if (!inTrend(reply.received_at)) continue;
    const sector = sectorByOrg.get(reply.organisation_id) ?? null;
    accFor(sector ?? UNKNOWN_SECTOR).repliedOrgs.add(reply.organisation_id);
  }
  for (const conversion of input.conversions) {
    if (!inTrend(conversion.created_at)) continue;
    const sector = sectorByOrg.get(conversion.organisation_id) ?? null;
    accFor(sector ?? UNKNOWN_SECTOR).convertedOrgs.add(conversion.organisation_id);
  }
  for (const score of input.scores) {
    if (score.priority_score === null) continue;
    const sector = sectorByOrg.get(score.organisation_id) ?? null;
    const acc = accFor(sector ?? UNKNOWN_SECTOR);
    acc.scoreSum += score.priority_score;
    acc.scoreCount += 1;
  }

  const rows: SectorPerformanceRow[] = [];
  for (const [sector, acc] of bySector) {
    rows.push({
      sector,
      orgsContacted: acc.orgs.size,
      emailsSent: acc.emails,
      replies: acc.repliedOrgs.size,
      replyRate: acc.emails > 0 ? acc.repliedOrgs.size / acc.emails : 0,
      conversionRate: acc.orgs.size > 0 ? acc.convertedOrgs.size / acc.orgs.size : 0,
      avgPriorityScore: acc.scoreCount > 0 ? acc.scoreSum / acc.scoreCount : null,
    });
  }
  // Where outreach actually works, first; ties break by volume.
  rows.sort(
    (a, b) =>
      b.conversionRate - a.conversionRate ||
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
