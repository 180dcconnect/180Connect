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

export type NotificationCategory = "team_activity" | "personal";

/**
 * F176 AC3: a team-activity digest must read as lower-stakes than a
 * personal, actionable notification (a reply, a reminder) "so a CAM doesn't
 * have to treat them with the same urgency" — a lookup keyed by
 * notification_type, the same shape a priority concept would take, rather
 * than a stored column: NOTIFICATIONS carries no such column, and adding one
 * to the shared table would force every existing and future producer to
 * decide a value for a distinction only this one type needs today. Anything
 * not explicitly team-activity defaults to "personal" — the safer default,
 * since treating a genuinely actionable notification as background noise is
 * the worse mistake of the two.
 */
const TEAM_ACTIVITY_TYPES: ReadonlySet<string> = new Set(["team_activity_digest"]);

export function notificationCategory(notificationType: string): NotificationCategory {
  return TEAM_ACTIVITY_TYPES.has(notificationType) ? "team_activity" : "personal";
}

/** Relative time for one row; callers pass their own now (see display-format.ts). */
export function notificationRelativeTime(
  item: NotificationItem,
  now: Date = new Date(),
): string {
  return formatRelativeTime(new Date(item.createdAt), now);
}
