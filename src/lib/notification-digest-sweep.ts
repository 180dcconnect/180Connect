import { reportError } from "./error-logging.ts";
import {
  DIGEST_ITEM_LIMIT,
  buildDigestEmail,
  digestWindowStart,
  isDigestDue,
  isDigestFrequency,
  type DigestNotification,
} from "./notification-digest.ts";

/**
 * Sends the daily and weekly digest emails. DB-wiring around
 * notification-digest.ts's pure core, same shape as reminder-sweep.ts: fetch
 * with the service-role admin client, compute, act, record what was done so
 * the next run doesn't repeat it.
 *
 * Runs from /api/cron/reminder-notifications, straight after the follow-up
 * sweep — not its own route, because Vercel Hobby allows 12 functions and
 * every cron route is one. After the sweep on purpose: follow-ups that become
 * due this morning land in this morning's digest.
 *
 * Recording: one `notification_digest_sent` audit_log row per email, target
 * the recipient's users row — the same watermark pattern the reminder and
 * team-activity sweeps use, so no schema change. Written only after the email
 * is accepted; a failed send leaves no marker and the next run tries again.
 */

const DIGEST_MARKER_ACTION = "notification_digest_sent";

/** Markers older than the longest period plus slack can't affect a decision. */
const MARKER_LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000;

export type NotificationDigestSweepResult = {
  dueRecipients: number;
  sent: number;
};

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  notification_frequency: string;
};

type MarkerRow = { target_id: string | null; created_at: string };

export async function runNotificationDigestSweep(
  now: Date = new Date(),
): Promise<NotificationDigestSweepResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not configured.");

  const { createAdminClient } = await import("./supabase/admin.ts");
  const admin = createAdminClient();
  if (!admin) throw new Error("Notification digests are not configured.");
  const { sendNotificationEmail } = await import("./notification-email.ts");

  const { data: users, error: usersError } = await admin
    .from("users")
    .select("id, email, full_name, notification_frequency")
    .eq("is_active", true)
    .in("notification_frequency", ["daily", "weekly"])
    .overrideTypes<UserRow[], { merge: false }>();
  if (usersError) throw usersError;
  if (!users || users.length === 0) return { dueRecipients: 0, sent: 0 };

  const { data: markers, error: markersError } = await admin
    .from("audit_log")
    .select("target_id, created_at")
    .eq("action", DIGEST_MARKER_ACTION)
    .eq("target_table", "users")
    .in(
      "target_id",
      users.map((user) => user.id),
    )
    .gte("created_at", new Date(now.getTime() - MARKER_LOOKBACK_MS).toISOString())
    .order("created_at", { ascending: false })
    .overrideTypes<MarkerRow[], { merge: false }>();
  // Without markers every daily user looks due and would be emailed twice on a
  // retry, so a failed read stops the run rather than guessing.
  if (markersError) throw markersError;

  const lastSent = new Map<string, Date>();
  for (const marker of markers ?? []) {
    if (marker.target_id && !lastSent.has(marker.target_id)) {
      lastSent.set(marker.target_id, new Date(marker.created_at));
    }
  }

  let dueRecipients = 0;
  let sent = 0;

  for (const user of users) {
    const frequency = user.notification_frequency;
    if (!isDigestFrequency(frequency) || !user.email) continue;
    const last = lastSent.get(user.id) ?? null;
    if (!isDigestDue(frequency, last, now)) continue;
    dueRecipients += 1;

    const windowStart = digestWindowStart(frequency, last, now);
    const {
      data: notifications,
      count,
      error: notificationsError,
    } = await admin
      .from("notifications")
      .select("notification_type, title, body, link_path, created_at", { count: "exact" })
      .eq("recipient_user_id", user.id)
      .is("read_at", null)
      .gte("created_at", windowStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(DIGEST_ITEM_LIMIT)
      .overrideTypes<DigestNotification[], { merge: false }>();
    if (notificationsError) {
      await reportError(notificationsError, {
        operation: "notification_digest.load",
        recipientUserId: user.id,
      });
      continue;
    }

    const listed = notifications ?? [];
    const totalUnread = count ?? listed.length;
    if (totalUnread === 0) continue;

    const email = buildDigestEmail({
      frequency,
      recipientName: user.full_name,
      notifications: listed,
      totalUnread,
      windowStart,
      appUrl,
    });

    const result = await sendNotificationEmail({ to: user.email, ...email });
    if (!result.ok) {
      await reportError(new Error(result.reason), {
        operation: "notification_digest.send",
        recipientUserId: user.id,
      });
      continue;
    }

    const { error: markerError } = await admin.from("audit_log").insert({
      actor_user_id: null,
      action: DIGEST_MARKER_ACTION,
      target_table: "users",
      target_id: user.id,
      detail: {
        frequency,
        unread: totalUnread,
        window_start: windowStart.toISOString(),
      },
    });
    if (markerError) {
      // The email went out; failing to record it means a rare duplicate
      // tomorrow — the safe direction, same as reminder-sweep's audit insert.
      await reportError(markerError, {
        operation: "notification_digest.marker_insert",
        recipientUserId: user.id,
      });
    }

    sent += 1;
  }

  return { dueRecipients, sent };
}
