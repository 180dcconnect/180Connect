import { NOTIFICATION_CATALOGUE } from "./notification-catalogue.ts";
import {
  NOTIFICATION_FREQUENCY_LABELS,
  type NotificationFrequency,
} from "./notification-preferences.ts";

/**
 * The digest email — pure core. What makes "Daily digest" and "Weekly digest"
 * (F178) real: before this, those settings only kept the bell quiet and no
 * digest was ever sent.
 *
 * Wiring (fetch users, send, record) lives in notification-digest-sweep.ts,
 * run from the daily /api/cron/reminder-notifications job.
 *
 * - Daily: one email at 9am UK time.
 * - Weekly: one email at 9am UK time on Mondays.
 *
 * 9am because the team is students. The cron runs at 08:00 and 09:00 UTC
 * (20261004140000_reschedule_reminder_notifications_cron.sql) — 9am London is
 * one or the other depending on BST — and only the 9am-London run sends.
 * - Contents: the recipient's notifications that arrived since their last
 *   digest (at most one period back) and are *still unread*. Nothing unread,
 *   no email — a digest that says "nothing happened" is noise.
 */

export type DigestFrequency = Exclude<NotificationFrequency, "immediate">;

/** Most items listed in one email; the rest are counted, not listed. */
export const DIGEST_ITEM_LIMIT = 40;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const PERIOD_MS: Record<DigestFrequency, number> = { daily: DAY_MS, weekly: 7 * DAY_MS };

/**
 * The shortest gap between two digests. Below a full period on purpose: the
 * cron fires at roughly the same minute each day, so a strict 24h check would
 * skip a day whenever today's run starts a few seconds earlier than
 * yesterday's.
 */
const MIN_GAP_MS: Record<DigestFrequency, number> = { daily: 20 * HOUR_MS, weekly: 6 * DAY_MS };

const LONDON = "Europe/London";

export function isDigestFrequency(value: unknown): value is DigestFrequency {
  return value === "daily" || value === "weekly";
}

/** The hour, in London, that digests go out. */
export const DIGEST_HOUR_LONDON = 9;

export function isLondonDigestHour(now: Date): boolean {
  const hour = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: LONDON,
  }).format(now);
  return Number(hour) === DIGEST_HOUR_LONDON;
}

export function isLondonMonday(now: Date): boolean {
  return (
    new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: LONDON }).format(now) === "Mon"
  );
}

/** Whether this run should send a digest to someone with this setting. */
export function isDigestDue(
  frequency: NotificationFrequency,
  lastSentAt: Date | null,
  now: Date,
): boolean {
  if (!isDigestFrequency(frequency)) return false;
  // The cron runs twice so one run lands on 9am in London in both BST and
  // GMT; the other run is not the digest run.
  if (!isLondonDigestHour(now)) return false;
  if (frequency === "weekly" && !isLondonMonday(now)) return false;
  return lastSentAt === null || now.getTime() - lastSentAt.getTime() >= MIN_GAP_MS[frequency];
}

/**
 * Where the digest's window opens: the last digest, but never more than one
 * period back — someone who switches from Immediate to Weekly should get last
 * week, not every unread notification since they joined.
 */
export function digestWindowStart(
  frequency: DigestFrequency,
  lastSentAt: Date | null,
  now: Date,
): Date {
  const periodStart = new Date(now.getTime() - PERIOD_MS[frequency]);
  return lastSentAt && lastSentAt > periodStart ? lastSentAt : periodStart;
}

export type DigestNotification = {
  notification_type: string;
  title: string;
  body: string | null;
  link_path: string | null;
  created_at: string;
};

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

function formatWhen(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: LONDON,
  });
}

export function buildDigestEmail(input: {
  frequency: DigestFrequency;
  recipientName: string | null;
  /** Newest first, at most DIGEST_ITEM_LIMIT. */
  notifications: readonly DigestNotification[];
  /** All unread in the window, including any not listed. */
  totalUnread: number;
  windowStart: Date;
  /** No trailing slash. */
  appUrl: string;
}): { subject: string; text: string } {
  const { frequency, notifications, totalUnread, windowStart, appUrl } = input;
  const noun = totalUnread === 1 ? "notification" : "notifications";
  const subject = `Your ${frequency} 180Connect digest: ${totalUnread} unread ${noun}`;

  // Grouped by kind, in the catalogue's order — the same order and wording as
  // Settings → Notifications — with anything uncatalogued last.
  const groups = new Map<string, DigestNotification[]>();
  const labelFor = new Map(NOTIFICATION_CATALOGUE.map((kind) => [kind.type, kind.label]));
  for (const kind of NOTIFICATION_CATALOGUE) groups.set(kind.label, []);
  for (const notification of notifications) {
    const label = labelFor.get(notification.notification_type) ?? "Other notifications";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(notification);
  }

  const firstName = input.recipientName?.trim().split(/\s+/)[0];
  const lines: string[] = [
    firstName ? `Hi ${firstName},` : "Hi,",
    "",
    `Here's what is still unread in 180Connect since ${formatWhen(windowStart)}.`,
  ];

  for (const [label, items] of groups) {
    if (items.length === 0) continue;
    lines.push("", `${label} (${items.length})`);
    for (const item of items) {
      lines.push(`  • ${oneLine(item.title, 140)}`);
      if (item.body) lines.push(`    ${oneLine(item.body, 200)}`);
      if (item.link_path) lines.push(`    ${appUrl}${item.link_path}`);
    }
  }

  const unlisted = totalUnread - notifications.length;
  if (unlisted > 0) {
    lines.push("", `…and ${unlisted} more waiting in 180Connect.`);
  }

  lines.push(
    "",
    `Open 180Connect: ${appUrl}/dashboard`,
    "",
    "—",
    `You get this because your notifications are set to ${NOTIFICATION_FREQUENCY_LABELS[frequency]}. ` +
      `To change that or stop these emails: ${appUrl}/settings/notifications`,
  );

  return { subject, text: lines.join("\n") };
}
