/**
 * F173 In-App Notifications — pure mapping/formatting logic.
 *
 * Everything that can be decided without a database or browser lives here so
 * it is unit-testable, mirroring src/lib/team-activity.ts. The server action
 * (notifications-actions.ts) fetches rows and hands the raw payloads through
 * mapNotificationRows; the bell component renders the result.
 */

import { formatRelativeTime } from "./display-format.ts";

/** How many notifications the bell panel loads per fetch. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

export type RawNotificationRow = {
  id: string;
  notification_type: string;
  title: string;
  body: string | null;
  link_path: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationItem = {
  id: string;
  notificationType: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Maps raw PostgREST rows to the client shape, dropping anything malformed
 * rather than throwing — a bad row must never blank the whole panel.
 */
export function mapNotificationRows(rows: unknown): NotificationItem[] {
  if (!Array.isArray(rows)) return [];
  const items: NotificationItem[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id === "") continue;
    if (typeof r.notification_type !== "string") continue;
    if (typeof r.title !== "string") continue;
    if (typeof r.created_at !== "string") continue;
    // Only absolute in-app paths ever reach a router push.
    const linkPath =
      typeof r.link_path === "string" && r.link_path.startsWith("/")
        ? r.link_path
        : null;
    items.push({
      id: r.id,
      notificationType: r.notification_type,
      title: r.title,
      body: typeof r.body === "string" ? r.body : null,
      linkPath,
      readAt: typeof r.read_at === "string" ? r.read_at : null,
      createdAt: r.created_at,
    });
  }
  return items;
}

/** Newest first, matching how every other feed in the app reads. */
export function sortNotificationsNewestFirst(
  items: NotificationItem[],
): NotificationItem[] {
  return [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export type NotificationPriority = "high" | "normal";

/**
 * F174 AC3: reply notifications are explicitly called out as high-priority
 * ("Important" note on that ticket); every other type defaults to normal
 * until a future one asks otherwise. NOTIFICATIONS carries no priority
 * column (docs/rls-permission-matrix.md §3.19) — adding one to the shared
 * table would force every existing and future producer to decide a value for
 * a distinction only this one type needs today, so it lives here instead, as
 * a lookup keyed by the type string every producer already sets.
 */
const HIGH_PRIORITY_TYPES: ReadonlySet<string> = new Set(["reply_received"]);

export function notificationPriority(notificationType: string): NotificationPriority {
  return HIGH_PRIORITY_TYPES.has(notificationType) ? "high" : "normal";
}

/**
 * F174 AC3: high-priority notifications lead the feed, so a CAM never has to
 * scroll past older, lower-priority items to find a reply that just came in.
 * Recency is still the tiebreaker within each priority tier — this is a
 * two-level sort, not a replacement for "newest first" — so when nothing in
 * the list is high-priority (every type before F174) the result is
 * identical to sortNotificationsNewestFirst.
 */
export function sortNotificationsByPriority(
  items: NotificationItem[],
): NotificationItem[] {
  return [...items].sort((a, b) => {
    const priorityA = notificationPriority(a.notificationType);
    const priorityB = notificationPriority(b.notificationType);
    if (priorityA !== priorityB) return priorityA === "high" ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** Relative time for one row; callers pass their own now (see display-format.ts). */
export function notificationRelativeTime(
  item: NotificationItem,
  now: Date = new Date(),
): string {
  return formatRelativeTime(new Date(item.createdAt), now);
}
