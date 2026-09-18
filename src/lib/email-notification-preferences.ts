/**
 * F179 (#175) — Email Notifications. Pure core: which notification types a
 * user wants emailed, and the small catalogue the settings form offers.
 *
 * `email_notification_types` (users, 20260920090000_add_email_notification_types.sql)
 * is the durable list; this file only decides how to read it and what's
 * selectable. Defaults to `{client_reply_received}` at the column level
 * (AC3), not here — so the default can never drift from what's actually
 * stored for a user who has never touched this setting.
 *
 * The token is F174's real producer type (supabase/migrations/
 * 20260912170300_notify_on_gmail_reply.sql — the reply_events trigger emits
 * `client_reply_received` for the client's owner), not a parallel
 * vocabulary: the settings form stores exactly the `notification_type`
 * value the in-app producer emits, so "email me this type" always lines up
 * with a notification that actually exists. The email consumer lives in
 * src/lib/gmail/reply-sync.ts via src/lib/notification-email.ts.
 */

import { NOTIFICATION_CATALOGUE } from "./notification-catalogue.ts";

export type EmailNotificationTypeOption = {
  type: string;
  label: string;
  description: string;
};

/**
 * The types with an email actually wired, read off the catalogue's
 * `emailable` flag so a toggle can never exist for an email nothing sends.
 *
 * - `client_reply_received` — F179, sent from src/lib/gmail/reply-sync.ts.
 * - `follow_up_due` — sent from src/lib/outreach/reminder-sweep.ts.
 * - `outreach_send_failed` — sent from src/lib/outreach/scheduled-worker.ts.
 *
 * F174's admin-fallback token (`unowned_client_reply_received`) deliberately
 * stays in-app only: it has no single CAM to own the signal.
 */
export const EMAIL_NOTIFICATION_TYPE_OPTIONS: readonly EmailNotificationTypeOption[] =
  NOTIFICATION_CATALOGUE.filter((kind) => kind.emailable).map(
    ({ type, label, description }) => ({ type, label, description }),
  );

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
