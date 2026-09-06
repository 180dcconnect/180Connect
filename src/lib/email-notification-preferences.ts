/**
 * F179 (#175) — Email Notifications. Pure core: which notification types a
 * user wants emailed, and the small catalogue the settings form offers.
 *
 * `email_notification_types` (users, 20260917090000_add_email_notification_types.sql)
 * is the durable list; this file only decides how to read it and what's
 * selectable. Defaults to `{client_reply_received}` at the column level
 * (AC3), not here — so the default can never drift from what's actually
 * stored for a user who has never touched this setting.
 *
 * The tokens are F174's real producer types (src/lib/gmail/reply-sync.ts /
 * supabase/migrations/20260912170300_notify_on_gmail_reply.sql), not a
 * parallel vocabulary: the settings form stores exactly the
 * `notification_type` value the in-app producer emits, so "email me this
 * type" always lines up with a notification that actually exists.
 */

export type EmailNotificationTypeOption = {
  type: string;
  label: string;
  description: string;
};

/**
 * Only the owning CAM's reply notification (`client_reply_received`, F174) is
 * emailable on this ticket — F179's "could be P1 for replies" scope. F174's
 * admin-fallback token (`unowned_client_reply_received`) deliberately stays
 * in-app only: it has no single CAM to own the signal. The list is still a
 * list, not a single boolean, so a future type is one array entry away from
 * its own toggle, not a schema change.
 */
export const EMAIL_NOTIFICATION_TYPE_OPTIONS: readonly EmailNotificationTypeOption[] = [
  {
    type: "client_reply_received",
    label: "Client replies",
    description: "Email me when a client I own replies to an outreach email.",
  },
];

/** Mirrors the migration's column default, for rendering fallbacks. */
export const DEFAULT_EMAIL_NOTIFICATION_TYPES: readonly string[] = [
  "client_reply_received",
];

/** F179 AC1 — does this user want `notificationType` emailed, in addition to in-app. */
export function wantsEmailNotification(
  emailTypes: readonly string[] | null | undefined,
  notificationType: string,
): boolean {
  return (emailTypes ?? []).includes(notificationType);
}

/**
 * Sanitises a form submission (a set of checkbox values) down to only the
 * types this app actually knows how to offer — a tampered POST could submit
 * any string, and silently trusting it would let a user's preference row
 * accumulate values no producer or UI ever checks again.
 */
export function parseEmailNotificationTypes(values: readonly unknown[]): string[] {
  const known = new Set(EMAIL_NOTIFICATION_TYPE_OPTIONS.map((option) => option.type));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !known.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
