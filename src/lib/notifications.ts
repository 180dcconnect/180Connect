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

/** Relative time for one row; callers pass their own now (see display-format.ts). */
export function notificationRelativeTime(
  item: NotificationItem,
  now: Date = new Date(),
): string {
  return formatRelativeTime(new Date(item.createdAt), now);
}

/**
 * F177 AC3 — the one place "is this notification unread" is decided, so the
 * bell's badge count, each row's visual treatment, and the click-to-mark-read
 * gate (AC2) can never silently disagree about what "unread" means. `readAt`
 * is only ever a real ISO string or `null` (see mapNotificationRows), so this
 * is equivalent to `!item.readAt` — named so every call site reads the same
 * intent rather than re-deriving it.
 */
export function isNotificationUnread(item: Pick<NotificationItem, "readAt">): boolean {
  return item.readAt === null;
}
