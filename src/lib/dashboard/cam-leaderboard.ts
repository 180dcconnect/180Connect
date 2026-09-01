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
 * THE FLAGGING RULES, and why each has a guard:
 * - `inactive`: sent nothing in the period. Not a performance judgement — it is
 *   the case a rate can't describe at all, and the one most worth an admin's
 *   attention (someone is blocked, on leave, or never onboarded).
 * - `needsSupport`: sent at least MIN_SAMPLE emails and replied-to at a rate
 *   below SUPPORT_RATIO of the team's median. Median, not mean, so one
 *   exceptional or one disastrous CAM doesn't drag the bar. The sample floor
 *   exists because 0 replies out of 3 emails is noise, and flagging it would
 *   train admins to ignore the flag.
 * - `lowConfidence`: under the sample floor, so the rates are shown greyed and
 *   marked rather than presented with the same authority as a well-sampled row.
 */
import type { PerformanceSummary, TeamUserRow, WeeklyCount } from "../performance-metrics.ts";

/**
 * Emails a CAM must have sent in the period before their rates are treated as
 * meaningful. 10 is the smallest number where a single reply moves the rate by
 * less than a tenth — below that the rate is describing luck.
 */
export const MIN_SAMPLE_EMAILS = 10;

/**
 * How far below the team median reply rate counts as "might need support".
 * 0.6 — a CAM getting under 60% of the median team response is a coaching
 * conversation, not a rounding difference.
 */
export const SUPPORT_RATIO = 0.6;

export type LeaderboardRow = {
  userId: string;
  name: string;
  emailsSent: number;
  replies: number;
  conversions: number;
  /** replies / emailsSent, or null when nothing was sent. */
  replyRate: number | null;
  /** conversions / emailsSent, or null when nothing was sent. */
  conversionRate: number | null;
  /** Sent nothing at all in the period. */
  inactive: boolean;
  /** Sent something, but under MIN_SAMPLE_EMAILS — rates are indicative only. */
  lowConfidence: boolean;
  /** Enough sample, and reply rate well below the team median. */
  needsSupport: boolean;
};

export type Leaderboard = {
  rows: LeaderboardRow[];
  /** Team reply rate over the period — the row the table compares against. */
  teamReplyRate: number | null;
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
 * One row per CAM in `cams` — including CAMs with no activity, who are absent
 * from `summary.people` and are precisely the rows an admin needs to see.
 *
 * Sorted by conversions, then replies, then emails sent, then name. Flags are
 * rendered as marks on the row rather than used as the sort key: an admin
 * scanning the table is looking for standing first, and re-ordering the table
 * by who is struggling would turn a performance view into a naughty step.
 */
export function camLeaderboard(
  summary: PerformanceSummary,
  cams: readonly TeamUserRow[],
): Leaderboard {
  const base = cams.map((cam) => {
    const person = summary.people.get(cam.id);
    const emailsSent = current(person?.emailsSent);
    const replies = current(person?.replies);
    const conversions = current(person?.conversions);
    return {
      userId: cam.id,
      name: cam.full_name?.trim() || "Unnamed CAM",
      emailsSent,
      replies,
      conversions,
      replyRate: emailsSent > 0 ? replies / emailsSent : null,
      conversionRate: emailsSent > 0 ? conversions / emailsSent : null,
    };
  });

  const sampled = base.filter((row) => row.emailsSent >= MIN_SAMPLE_EMAILS);
  const medianReplyRate = median(
    sampled.map((row) => row.replyRate ?? 0),
  );

  const teamSent = current(summary.team.emailsSent);
  const teamReplyRate = teamSent > 0 ? current(summary.team.replies) / teamSent : null;

  const rows: LeaderboardRow[] = base.map((row) => {
    const inactive = row.emailsSent === 0;
    const lowConfidence = !inactive && row.emailsSent < MIN_SAMPLE_EMAILS;
    const needsSupport =
      !inactive &&
      !lowConfidence &&
      medianReplyRate !== null &&
      medianReplyRate > 0 &&
      (row.replyRate ?? 0) < medianReplyRate * SUPPORT_RATIO;

    return { ...row, inactive, lowConfidence, needsSupport };
  });

  rows.sort((a, b) => {
    if (a.conversions !== b.conversions) return b.conversions - a.conversions;
    if (a.replies !== b.replies) return b.replies - a.replies;
    if (a.emailsSent !== b.emailsSent) return b.emailsSent - a.emailsSent;
    return a.name.localeCompare(b.name);
  });

  return {
    rows,
    teamReplyRate,
    medianReplyRate,
    needsSupportCount: rows.filter((row) => row.needsSupport).length,
    inactiveCount: rows.filter((row) => row.inactive).length,
  };
}
