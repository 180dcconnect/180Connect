/**
 * Formatting shared by any page that shows a list of timestamped records.
 *
 * Extracted from `audit-log-format.ts` when the import-status page needed the
 * same relative times and day headings. Two hand-copied versions of "2 hours
 * ago" drift the moment one of them is fixed — the same reasoning that keeps the
 * brand tokens in one file (docs/design-system.md §Source of truth).
 *
 * Everything here is pure and meant to run **on the server**: a relative time
 * computed in the browser disagrees with the SSR output and trips a hydration
 * mismatch. Callers pass their own `now` so one page has one clock.
 */

/** "invite_cancelled" -> "Invite cancelled". */
export function humaniseToken(token: string): string {
  const spaced = token.replace(/_/g, " ").trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "Just now" / "12 minutes ago" / "3 days ago", stopping at a week — past that
 * the calendar date is the more useful answer and the day heading already
 * carries it.
 */
export function formatRelativeTime(when: Date, now: Date): string {
  const elapsed = now.getTime() - when.getTime();
  if (elapsed < 0) return "Just now";
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return formatDayLabel(when, now);
}

/** en-GB, spelled out, no seconds. Fixed locale so server and client agree. */
export function formatExactTime(when: Date): string {
  return when.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * How long something took, in the largest unit that still says something: a
 * three-hour import reported as "10,847 seconds" is a number nobody can hold.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Local-calendar key, not the ISO date: 23:30 on the 3rd is the 3rd. */
export function dayKeyOf(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

/** "Today" / "Yesterday" / "14 August 2026" — a feed's section headings. */
export function formatDayLabel(when: Date, now: Date): string {
  const today = dayKeyOf(now);
  const key = dayKeyOf(when);
  if (key === today) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKeyOf(yesterday)) return "Yesterday";

  return when.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: when.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Anything a feed can group: it knows which day it belongs to and its heading. */
export type Dated = { dayKey: string; dayLabel: string };

/** Consecutive items on the same calendar day, in the order they arrived. */
export function groupByDay<T extends Dated>(items: T[]): { key: string; label: string; events: T[] }[] {
  const groups: { key: string; label: string; events: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.key === item.dayKey) {
      last.events.push(item);
    } else {
      groups.push({ key: item.dayKey, label: item.dayLabel, events: [item] });
    }
  }
  return groups;
}
