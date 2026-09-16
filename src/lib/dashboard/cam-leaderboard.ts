/**
 * F212 (#207) — Manager Analytics: every CAM's numbers side by side, with the
 * ones who look like they need support called out.
 *
 * The Performance section already computes a per-person rollup for the whole
 * team (`PerformanceSummary.people`) and then shows exactly one person at a
 * time, because its scope control is a filter. An admin comparing the team had
 * to click through the CAM picker one name at a time and hold the numbers in
 * their head. This turns that same already-computed map into rows.
 *
 * AC2 is explicit that the view must highlight who needs support rather than
 * "just presenting raw undifferentiated numbers", and AC3 that it must degrade
 * gracefully — so the flags are derived here from whatever data exists, with no
 * dependency on F208/F210 landing first.
 *
 * THE TWO RATES are the shared ones (`lib/outreach-rates.ts`): reply rate is
 * replied clients over contacted clients, win rate is converted clients over
 * clients who responded (replied ∪ converted). This row used to divide both
 * events and clients by *emails sent* — a CAM who sent three follow-ups to one
 * silent charity read as more responsive than one who sent a single email and
 * got an answer — so the table, the sector table and the funnel now multiply
 * out to the same story. Beside them, every count is in clients too, except
 * `emailsSent`: a table headed by a rate of clients, with event counts in the
 * columns under it, invites an admin to divide the wrong two numbers.
 *
 * THE FLAGGING RULES, and why each has a guard:
 * - `inactive`: contacted nobody in the period. Not a performance judgement —
 *   it is the case a rate can't describe at all, and the one most worth an
 *   admin's attention (someone is blocked, on leave, or never onboarded).
 * - `needsSupport`: contacted at least MIN_SAMPLE_CONTACTS clients and earned
 *   replies at a rate below SUPPORT_RATIO of the team's median. Median, not
 *   mean, so one exceptional or one disastrous CAM doesn't drag the bar. The
 *   floor exists because 0 replies out of 3 clients is noise, and flagging it
 *   would train admins to ignore the flag.
 * - `lowConfidence`: under the floor, so the rates are shown greyed and marked
 *   rather than presented with the same authority as a well-sampled row.
 */
import type { PerformanceSummary, TeamUserRow, WeeklyCount } from "../performance-metrics.ts";

/**
 * Distinct clients a CAM must have contacted before their rates are treated as
 * meaningful. 10 is the smallest number where a single reply moves the rate by
 * less than a tenth — below that the rate is describing luck.
 *
 * Deliberately on contacted *clients*, not sent emails: the rates above are
 * ratios of clients, so the sample has to be measured in the denominator's
 * unit. This is the stricter bar of the two (a CAM clears 10 emails before
 * they clear 10 clients) and that is intended — 10 emails to one charity is
 * one client's worth of evidence.
 */
export const MIN_SAMPLE_CONTACTS = 10;

/**
 * How far below the team median reply rate counts as "might need support".
 * 0.6 — a CAM getting under 60% of the median team response is a coaching
 * conversation, not a rounding difference.
 */
export const SUPPORT_RATIO = 0.6;

export type LeaderboardRow = {
  userId: string;
  name: string;
  /** Emails, an event count: three emails to one charity are three of these. */
  emailsSent: number;
  /** Clients, not events — the unit both rates are built from. */
  contactedClients: number;
  repliedClients: number;
  respondedClients: number;
  convertedClients: number;
  /** replied clients / contacted clients, or null when nobody was contacted. */
  replyRate: number | null;
  /** converted clients / responded clients, or null when nobody responded. */
  winRate: number | null;
  /** Contacted nobody at all in the period. */
  inactive: boolean;
  /** Contacted someone, but under MIN_SAMPLE_CONTACTS — rates are indicative only. */
  lowConfidence: boolean;
  /** Enough sample, and reply rate well below the team median. */
  needsSupport: boolean;
};

export type Leaderboard = {
  rows: LeaderboardRow[];
  /** Team reply rate over the period — the row the table compares against. */
  teamReplyRate: number | null;
  /** Team win rate over the period. */
  teamWinRate: number | null;
  /** Median reply rate across sufficiently-sampled CAMs; null when none are. */
  medianReplyRate: number | null;
  /** How many rows carry the support flag, for the section's caption. */
  needsSupportCount: number;
  inactiveCount: number;
};

/** `thisWeek` is "this period" once `performanceForPeriod` has re-derived it. */
const current = (count: WeeklyCount | undefined): number => count?.thisWeek ?? 0;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * One row per team member in `cams` — including members with no activity, who are absent
 * from `summary.people` and are precisely the rows an admin needs to see.
 *
 * Sorted by clients won, then responding clients, then contacted clients, then
 * name. Flags are rendered as marks on the row rather than used as the sort
 * key: an admin scanning the table is looking for standing first, and
 * re-ordering the table by who is struggling would turn a performance view into
 * a naughty step. Sorted in clients rather than events for the same reason the
 * rates are — a hundred follow-ups into silence is not a hundred units of
 * standing.
 */
export function camLeaderboard(
  summary: PerformanceSummary,
  cams: readonly TeamUserRow[],
): Leaderboard {
  const base = cams.map((cam) => {
    const person = summary.people.get(cam.id);
    return {
      userId: cam.id,
      name: cam.full_name?.trim() || (cam.role === "admin" ? "Unnamed Admin" : "Unnamed CAM"),
      emailsSent: current(person?.emailsSent),
      contactedClients: person?.contactedClients ?? 0,
      repliedClients: person?.repliedClients ?? 0,
      respondedClients: person?.respondedClients ?? 0,
      convertedClients: person?.convertedClients ?? 0,
      replyRate: person?.replyRate ?? null,
      winRate: person?.winRate ?? null,
    };
  });

  const sampled = base.filter((row) => row.contactedClients >= MIN_SAMPLE_CONTACTS);
  const medianReplyRate = median(
    sampled.map((row) => row.replyRate ?? 0),
  );

  const teamReplyRate = summary.team.replyRate;
  const teamWinRate = summary.team.winRate;

  const rows: LeaderboardRow[] = base.map((row) => {
    const inactive = row.contactedClients === 0;
    const lowConfidence = !inactive && row.contactedClients < MIN_SAMPLE_CONTACTS;
    const needsSupport =
      !inactive &&
      !lowConfidence &&
      medianReplyRate !== null &&
      medianReplyRate > 0 &&
      (row.replyRate ?? 0) < medianReplyRate * SUPPORT_RATIO;

    return { ...row, inactive, lowConfidence, needsSupport };
  });

  rows.sort((a, b) => {
    if (a.convertedClients !== b.convertedClients) return b.convertedClients - a.convertedClients;
    if (a.respondedClients !== b.respondedClients) return b.respondedClients - a.respondedClients;
    if (a.contactedClients !== b.contactedClients) return b.contactedClients - a.contactedClients;
    return a.name.localeCompare(b.name);
  });

  return {
    rows,
    teamReplyRate,
    teamWinRate,
    medianReplyRate,
    needsSupportCount: rows.filter((row) => row.needsSupport).length,
    inactiveCount: rows.filter((row) => row.inactive).length,
  };
}
