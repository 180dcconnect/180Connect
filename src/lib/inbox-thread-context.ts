/**
 * Derived facts about one client relationship, for the thread view's context
 * rail (/inbox/[orgId]).
 *
 * Every function here is pure and reads only what the thread route already
 * fetched — no new query pays for this block. Kept out of the route for the
 * same reason as @/lib/outreach-inbox: it can then be tested without a
 * database.
 *
 * Deliberately NOT here: owner name, notes, attachments. Those are rows the
 * route reads and hands to the rail already shaped by their own existing
 * builders (@/lib/note-history, @/lib/attachments, @/lib/timeline) — this
 * module only covers the one thing nothing else derives, the shape of the
 * conversation over time.
 */

import type { ConversationEntry } from "./outreach-inbox.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type RelationshipStats = {
  /** First email we sent. Null for a thread that somehow opens on a reply. */
  firstContactAt: string | null;
  /** Newest event of any kind in the thread. */
  lastActivityAt: string;
  /** Whole days from first contact to `now`. Null when firstContactAt is. */
  daysSinceFirstContact: number | null;
  /** Whole days since the newest event, whichever side sent it. */
  daysSinceLastActivity: number;
  sentCount: number;
  replyCount: number;
  /**
   * Set when the newest event is one of ours sent *after* a client reply —
   * i.e. the ball is in their court and has been since this timestamp. Null
   * otherwise. Same condition @/lib/outreach-inbox's `threadStatus` calls
   * "awaiting", expressed as a date rather than a token so the rail can say
   * how long the wait has been.
   */
  awaitingSince: string | null;
};

/** Whole days between two instants, floored, never negative. */
function daysBetween(earlier: Date, later: Date): number {
  const diff = later.getTime() - earlier.getTime();
  return diff > 0 ? Math.floor(diff / MS_PER_DAY) : 0;
}

/**
 * `entries` arrives oldest-first, exactly as `buildConversation` returns it —
 * this reads the ends of that array rather than re-sorting, so the two can
 * never disagree about which event is newest.
 *
 * Returns null for an empty thread: the rail renders nothing rather than a row
 * of zeroes, which would read as "we have contacted them 0 times" instead of
 * "there is no conversation here yet".
 */
export function buildRelationshipStats(
  entries: readonly ConversationEntry[],
  now: Date = new Date(),
): RelationshipStats | null {
  if (entries.length === 0) return null;

  const sent = entries.filter((entry) => entry.type === "email_sent");
  const replies = entries.filter((entry) => entry.type === "reply_received");

  const firstContactAt = sent[0]?.timestamp ?? null;
  const newest = entries[entries.length - 1];
  const lastActivityAt = newest.timestamp;

  // "Awaiting" only means something once the client has actually replied at
  // least once — a first send nobody has answered yet is "sent", not a wait
  // we are owed an answer on. Mirrors threadStatus's two-armed check.
  const lastReplyAt = replies.length > 0 ? replies[replies.length - 1].timestamp : null;
  const awaitingSince =
    newest.type === "email_sent" && lastReplyAt !== null && lastReplyAt < newest.timestamp
      ? newest.timestamp
      : null;

  return {
    firstContactAt,
    lastActivityAt,
    daysSinceFirstContact: firstContactAt ? daysBetween(new Date(firstContactAt), now) : null,
    daysSinceLastActivity: daysBetween(new Date(lastActivityAt), now),
    sentCount: sent.length,
    replyCount: replies.length,
    awaitingSince,
  };
}

/**
 * "8 days" / "1 day" / "today" — the rail says durations in words next to an
 * exact date, so the number alone (which reads as a bare "0" on the day of
 * first contact) never has to stand on its own.
 */
export function formatDayCount(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Ownership handovers, newest first, capped for the rail.
 *
 * The entries themselves come from @/lib/timeline's
 * `buildOwnershipReassignedEntry` — there is no ownership_history table, so
 * audit_log is the only record of who held a client before, and that builder
 * is already the tested way to read it. This just orders and trims the result
 * so the rail shows recent handovers rather than a full history nobody can
 * scan in a 320px column.
 */
export function recentHandovers<T extends { timestamp: string }>(
  entries: readonly T[],
  limit = 3,
): T[] {
  return [...entries]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
