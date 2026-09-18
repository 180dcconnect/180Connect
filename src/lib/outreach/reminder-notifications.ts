/**
 * F175 (#171) — Reminder Notifications. Pure core: which of the team-wide
 * follow-up recommendations (F160) are actually new enough to notify their
 * owner about, and the copy for that notification. No database — the sweep
 * (reminder-sweep.ts) assembles inputs and calls create_notification, same
 * split as follow-up-recommendations.ts and stall-detection.ts.
 */
import type { FollowUpRecommendation } from "./follow-up-recommendations.ts";

export type ReminderRecommendation = FollowUpRecommendation & {
  ownerId: string;
};

export type PriorReminderNotification = {
  organisationId: string;
  /** The activity-clock value (FollowUpRecommendation.lastActivityAt) that triggered the notification already sent for this client. */
  lastActivityAt: string;
};

/**
 * F175 AC3 — the whole feature on this side: a client already notified for
 * this exact staleness episode is skipped. "Episode" is identified by
 * `lastActivityAt`, the same activity-clock value the recommendation itself
 * is computed against (F160's latest of sent email / received reply /
 * audited status change). The moment the CAM takes the recommended action —
 * sends a follow-up, or the client replies, or the status changes — that
 * clock moves forward, and the client becomes eligible again the next time
 * it re-crosses a threshold. That is a genuinely new event, not a repeat of
 * the one already sent; comparing the two timestamps is what tells them
 * apart without a separate "already reminded" flag to keep in sync.
 */
export function selectNewReminders(
  recommendations: readonly ReminderRecommendation[],
  priorNotifications: readonly PriorReminderNotification[],
): ReminderRecommendation[] {
  const lastNotifiedByOrg = new Map(
    priorNotifications.map((p) => [p.organisationId, p.lastActivityAt]),
  );
  return recommendations.filter(
    (rec) => lastNotifiedByOrg.get(rec.organisationId) !== rec.lastActivityAt,
  );
}

/** F175 AC2 — the client's name is readable from the title alone, no need to open it. */
export function reminderNotificationTitle(legalName: string): string {
  return `Follow up with ${legalName}`;
}

/** Same "Nd · Send a follow-up / Follow up now" phrasing the dashboard's AttentionList already uses, so the wording matches wherever a CAM sees this recommendation. */
export function reminderNotificationBody(
  recommendation: Pick<FollowUpRecommendation, "daysWaiting" | "urgency">,
): string {
  const days = `${recommendation.daysWaiting} day${recommendation.daysWaiting === 1 ? "" : "s"} without a reply.`;
  return recommendation.urgency === "urgent" ? `${days} This is now urgent.` : days;
}
