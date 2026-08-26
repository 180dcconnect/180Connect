/**
 * F160 (#155) — Follow-Up Recommendations. Which of a CAM's own clients have
 * been sitting silent long enough that the platform should say "send a follow-up".
 *
 * This module is the pure core: it owns the trigger statuses, the activity
 * clock, the threshold comparison and the urgency levels, and touches no
 * database — the dashboard assembles inputs and renders output (F027 Needs
 * Attention panel), and F175 (Reminder Notifications) consumes the same shape
 * when recommendations become notifications.
 *
 * THE RULES, agreed with the PM 26 Aug 2026:
 * - Trigger statuses: initial_outreach_sent, follow_up_sent AND no_response
 *   (AC1 names the latter two; Initial Outreach Sent was deliberately added —
 *   the preferences' first-follow-up threshold semantically applies to exactly
 *   those clients, who are Stage-2 eligible).
 * - Activity clock: the LATEST of the client's last sent email, last received
 *   reply, last status_changed audit entry. Any of the three resets the
 *   silence count.
 * - Thresholds are the OWNER'S outreach_preferences (first_follow_up_days /
 *   second_follow_up_days), defaulting to the AC's 7 and 14 days. Every client
 *   in a trigger status has at least one audited status transition behind it,
 *   so a client with NO recorded activity cannot be measured for silence and
 *   is skipped rather than guessed at.
 */
import { formatOutreachStatus } from "../organisation-format.ts";

export const FOLLOW_UP_TRIGGER_STATUSES: ReadonlySet<string> = new Set([
  "initial_outreach_sent",
  "follow_up_sent",
  "no_response",
]);

/** AC defaults — also the database column defaults (20260828130000). */
export const DEFAULT_FOLLOW_UP_THRESHOLDS: FollowUpThresholds = { first: 7, second: 14 };

export type FollowUpThresholds = { first: number; second: number };

export type FollowUpUrgency = "due" | "urgent";

export type ClientActivity = {
  lastEmailSentAt?: string | null;
  lastReplyReceivedAt?: string | null;
  lastStatusChangeAt?: string | null;
};

export type FollowUpCandidate = {
  id: string;
  legal_name: string;
  outreach_status: string;
};

export type FollowUpRecommendation = {
  organisationId: string;
  legalName: string;
  statusLabel: string;
  /** ISO instant of the newest activity found, when one exists. */
  lastActivityAt: string;
  /** Whole days of silence, floored — day 7 begins at exactly 7×24h. */
  daysWaiting: number;
  urgency: FollowUpUrgency;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The activity clock: the newest of the three sources, ignoring absent or
 * unparseable timestamps rather than letting one bad row hide the others.
 */
export function lastActivityAt(activity: ClientActivity): string | null {
  let newest: number | null = null;
  for (const value of [
    activity.lastEmailSentAt,
    activity.lastReplyReceivedAt,
    activity.lastStatusChangeAt,
  ]) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) continue;
    if (newest === null || parsed > newest) newest = parsed;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

function normaliseThresholds(thresholds: FollowUpThresholds): { first: number; second: number } {
  // A CAM who sets first above second would make "due" unreachable while
  // "urgent" fires — fold the pair so the lower value always comes first.
  const lower = Math.max(1, Math.min(thresholds.first, thresholds.second));
  const upper = Math.max(lower, thresholds.first, thresholds.second);
  return { first: lower, second: upper };
}

/**
 * The recommendations themselves: the given candidates filtered to the trigger
 * statuses, measured against their activity clocks, kept only once they pass
 * the first threshold. Urgent (second threshold) sorts above due, longest
 * silence within each level — the top of the list is always the most neglected
 * client.
 */
export function followUpRecommendations(
  candidates: readonly FollowUpCandidate[],
  activityByOrganisation: ReadonlyMap<string, ClientActivity>,
  thresholds: FollowUpThresholds = DEFAULT_FOLLOW_UP_THRESHOLDS,
  now: Date = new Date(),
): FollowUpRecommendation[] {
  const { first, second } = normaliseThresholds(thresholds);
  const nowMs = now.getTime();

  const recommendations: FollowUpRecommendation[] = [];
  for (const candidate of candidates) {
    if (!FOLLOW_UP_TRIGGER_STATUSES.has(candidate.outreach_status)) continue;

    const activity = activityByOrganisation.get(candidate.id);
    const lastActivity = activity ? lastActivityAt(activity) : null;
    if (!lastActivity) continue;

    const lastMs = Date.parse(lastActivity);
    const daysWaiting = Math.floor((nowMs - lastMs) / DAY_MS);
    if (daysWaiting < first) continue;

    recommendations.push({
      organisationId: candidate.id,
      legalName: candidate.legal_name,
      statusLabel: formatOutreachStatus(candidate.outreach_status),
      lastActivityAt: lastActivity,
      daysWaiting,
      urgency: daysWaiting >= second ? "urgent" : "due",
    });
  }

  return recommendations.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
    if (a.daysWaiting !== b.daysWaiting) return b.daysWaiting - a.daysWaiting;
    return a.legalName.localeCompare(b.legalName);
  });
}
