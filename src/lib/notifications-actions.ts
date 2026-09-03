"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import {
  NOTIFICATIONS_PAGE_SIZE,
  mapNotificationRows,
  sortNotificationsNewestFirst,
  type NotificationItem,
} from "@/lib/notifications";
import { isNotificationFrequency, type NotificationFrequency } from "@/lib/notification-preferences";

// ─── Read the feed ───────────────────────────────────────────────────────────

export type NotificationsResult =
  | { ok: true; items: NotificationItem[]; unreadCount: number; frequency: NotificationFrequency }
  | { ok: false; message: string };

/**
 * The signed-in user's most recent notifications, total unread count, and
 * their own delivery-frequency preference (F178) — fetched together so the
 * bell has everything it needs (including what shouldDeliverImmediately
 * needs for the realtime handler) from one round trip.
 *
 * RLS (notifications_select_own) scopes every row to the caller — there is no
 * recipient filter here because Postgres already applies it, and adding one
 * client-side would only invite drift from what the policy enforces.
 */
export async function getMyNotifications(): Promise<NotificationsResult> {
  const authorization = await getCurrentActor(undefined, { route: "/notifications" });
  if (!authorization.ok) {
    return { ok: false, message: "Could not load notifications." };
  }

  const supabase = await createClient();

  const [listResult, countResult, userResult] = await Promise.all([
    supabase
      .from("notifications")
      .select(
        "id, notification_type, title, body, link_path, read_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(NOTIFICATIONS_PAGE_SIZE),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
    supabase
      .from("users")
      .select("notification_frequency")
      .eq("id", authorization.actor.id)
      .maybeSingle<{ notification_frequency: string }>(),
  ]);

  if (listResult.error) {
    await reportError(listResult.error, { operation: "notifications.list" });
    return { ok: false, message: "Could not load notifications." };
  }
  if (countResult.error) {
    // Non-fatal: the list still renders, just without the unread badge.
    await reportError(countResult.error, { operation: "notifications.unread_count" });
  }
  if (userResult.error) {
    // Non-fatal: falls back to "immediate", the safer default (a CAM who
    // asked to be interrupted less should not silently get *more* noise, but
    // never *less* than they'd get from a failed read is the safer failure).
    await reportError(userResult.error, { operation: "notifications.frequency" });
  }

  return {
    ok: true,
    items: sortNotificationsNewestFirst(mapNotificationRows(listResult.data)),
    unreadCount: countResult.count ?? 0,
    frequency: isNotificationFrequency(userResult.data?.notification_frequency)
      ? userResult.data.notification_frequency
      : "immediate",
  };
}

// ─── Mark read ───────────────────────────────────────────────────────────────

/**
 * Marks one notification read via the mark_notification_read SECURITY DEFINER
 * RPC — read_at has a column grant, but the RPC is the reviewed path that
 * self-checks ownership inside its body. Returns whether this call actually
 * transitioned the row.
 */
export async function markNotificationRead(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_notification_read", {
    p_id: id,
  });
  if (error) {
    await reportError(error, { operation: "notifications.mark_read" });
    return false;
  }
  return data === true;
}

/** Marks every unread notification for the caller read; returns how many. */
export async function markAllNotificationsRead(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) {
    await reportError(error, { operation: "notifications.mark_all_read" });
    return 0;
  }
  return typeof data === "number" ? data : 0;
}
