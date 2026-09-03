/**
 * F178 (#174) — Notification Preferences. Pure core: the frequency enum
 * itself, and which notification types bypass it. No database — the
 * settings form (settings/notifications) reads/writes
 * `users.notification_frequency` directly (already granted by
 * 20260828130000_add_notification_frequency_and_followup_timing.sql, F201),
 * and the bell (notification-bell.tsx) calls shouldDeliverImmediately to
 * decide whether a newly-arrived row should interrupt the viewer right now.
 */

export const NOTIFICATION_FREQUENCIES = ["immediate", "daily", "weekly"] as const;

export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

export function isNotificationFrequency(value: unknown): value is NotificationFrequency {
  return (
    typeof value === "string" &&
    (NOTIFICATION_FREQUENCIES as readonly string[]).includes(value)
  );
}

export const NOTIFICATION_FREQUENCY_LABELS: Record<NotificationFrequency, string> = {
  immediate: "Immediate",
  daily: "Daily digest",
  weekly: "Weekly digest",
};

export const NOTIFICATION_FREQUENCY_DESCRIPTIONS: Record<NotificationFrequency, string> = {
  immediate: "See every notification the moment it arrives.",
  daily: "Notifications still arrive, but the bell won't interrupt you until your next visit that day.",
  weekly: "Notifications still arrive, but the bell won't interrupt you until you check in that week.",
};

/**
 * F178 AC3: notification types that always deliver immediately regardless
 * of the recipient's own frequency preference — the ticket's own example is
 * replies ("always-immediate for replies per F174"). F174 is not built on
 * this branch, but the override is a general rule, not a one-off special
 * case: a future high-priority producer opts in here once, rather than
 * every read path having to know about it separately.
 */
const ALWAYS_IMMEDIATE_TYPES: ReadonlySet<string> = new Set(["reply_received"]);

/**
 * F178 AC2: the single decision every delivery surface defers to — "should
 * this notification interrupt the recipient right now, or can it wait for
 * their next digest window". `immediate` always says yes; a
 * daily/weekly preference says no *unless* the type itself is one of the
 * always-immediate overrides above, which take priority over the
 * recipient's own setting exactly as AC2 describes ("unless a specific type
 * is configured to override it").
 *
 * This governs the bell's real-time push/refresh behaviour, not whether a
 * NOTIFICATIONS row gets written — every producer still creates its row the
 * moment its event happens (the durable record), same as before this
 * ticket. What changes is only how eagerly a daily/weekly recipient is
 * interrupted about it; nothing is ever hidden or lost, and a normal page
 * visit always shows everything unread regardless of frequency.
 */
export function shouldDeliverImmediately(
  frequency: NotificationFrequency,
  notificationType: string,
): boolean {
  return frequency === "immediate" || ALWAYS_IMMEDIATE_TYPES.has(notificationType);
}
