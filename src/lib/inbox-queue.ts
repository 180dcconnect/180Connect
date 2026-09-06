/**
 * The inbox as a work queue rather than a mailbox.
 *
 * `@/lib/outreach-inbox` already turns messages and replies into one thread per
 * organisation. This module answers the next question — *which of these threads
 * is work, and whose* — so `/inbox` can open on the rows that need the signed-in
 * CAM rather than on everything that has ever been sent.
 *
 * Three buckets, and the vocabulary is deliberately borrowed rather than
 * reinvented:
 *
 * - **needs_reply** — `threadStatus` says "replied". The client answered and the
 *   ball is ours. The most expensive state to leave rotting, so it sorts first.
 * - **follow_up_due** — the thread is quiet AND F160
 *   (@/lib/outreach/follow-up-recommendations) says this client has been silent
 *   past the owner's threshold. Carries that module's urgency through unchanged.
 * - **awaiting_them** — everything else: we sent, the wait is still reasonable.
 *
 * Ordering within a bucket is by how long the thread has been waiting, longest
 * first. Note what is NOT used: `InboxThread.isRecent`. That flag exists to
 * highlight a reply from the last 48 hours in a list, and as a queue rule it is
 * exactly backwards — a reply gets *more* urgent as it ages, which is the same
 * reasoning already written into @/lib/dashboard/reply-queue.ts.
 *
 * Pure, like its neighbours: no database, no clock of its own unless the caller
 * declines to pass one.
 */

import type { FollowUpRecommendation, FollowUpUrgency } from "./outreach/follow-up-recommendations.ts";
import type { InboxThread } from "./outreach-inbox.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which pile of work a thread lands in. */
export type InboxQueueBucket = "needs_reply" | "follow_up_due" | "awaiting_them";

/**
 * Who a row belongs to, from the signed-in CAM's point of view. `team` is
 * everyone else — including clients with no owner at all, which are still
 * somebody's problem and must not vanish between the two scopes.
 */
export type InboxScope = "mine" | "team" | "all";

export const INBOX_SCOPES: readonly InboxScope[] = ["mine", "team", "all"];
export const INBOX_BUCKETS: readonly InboxQueueBucket[] = [
  "needs_reply",
  "follow_up_due",
  "awaiting_them",
];

/** A thread, plus the facts that decide whether it is work and whose. */
export type InboxQueueRow = InboxThread & {
  /** ORGANISATIONS.owner_id. Null where nobody owns the client yet. */
  ownerId: string | null;
  isMine: boolean;
  bucket: InboxQueueBucket;
  /** Whole days since the newest event in the thread, floored, never negative. */
  daysWaiting: number;
  /** F160's urgency, when this client is also a follow-up recommendation. */
  followUpUrgency: FollowUpUrgency | null;
};

/** Reading order of the buckets, and therefore of the page. */
const BUCKET_RANK: Record<InboxQueueBucket, number> = {
  needs_reply: 0,
  follow_up_due: 1,
  awaiting_them: 2,
};

/** Urgent before due, so the most neglected client is the top of its bucket. */
const URGENCY_RANK: Record<FollowUpUrgency, number> = { urgent: 0, due: 1 };

export function daysSince(timestamp: string, now: Date): number {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return 0;
  const diff = now.getTime() - parsed;
  return diff > 0 ? Math.floor(diff / DAY_MS) : 0;
}

/**
 * Threads → queue rows, ordered.
 *
 * `ownerIds` and `recommendations` are both looked up by organisation id and
 * both may be missing an entry: a thread whose organisation has no owner row is
 * unowned rather than dropped, and a thread with no recommendation simply is
 * not due a follow-up. Nothing here can shrink the list — every thread in comes
 * out, which is what makes the "All" scope trustworthy.
 */
export function buildInboxQueue(
  threads: readonly InboxThread[],
  ownerIds: ReadonlyMap<string, string | null>,
  recommendations: readonly FollowUpRecommendation[],
  actorId: string,
  now: Date = new Date(),
): InboxQueueRow[] {
  const urgencyByOrg = new Map<string, FollowUpUrgency>();
  for (const recommendation of recommendations) {
    urgencyByOrg.set(recommendation.organisationId, recommendation.urgency);
  }

  const rows: InboxQueueRow[] = threads.map((thread) => {
    const ownerId = ownerIds.get(thread.orgId) ?? null;
    const followUpUrgency = urgencyByOrg.get(thread.orgId) ?? null;
    // A reply outranks a follow-up prompt: if they have written to us, chasing
    // them is not the next action, answering is.
    const bucket: InboxQueueBucket =
      thread.status === "replied"
        ? "needs_reply"
        : followUpUrgency !== null
          ? "follow_up_due"
          : "awaiting_them";

    return {
      ...thread,
      ownerId,
      isMine: ownerId !== null && ownerId === actorId,
      bucket,
      daysWaiting: daysSince(thread.lastActivityAt, now),
      followUpUrgency,
    };
  });

  return sortQueueRows(rows);
}

/**
 * The queue's order, exported because rows can arrive from more than one place
 * (the live database, and for now the design fill) and a concatenation must not
 * be re-sorted by a second, subtly different rule.
 */
export function sortQueueRows(rows: readonly InboxQueueRow[]): InboxQueueRow[] {
  return [...rows].sort((a, b) => {
    if (a.bucket !== b.bucket) return BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
    const rankA = a.followUpUrgency ? URGENCY_RANK[a.followUpUrgency] : 2;
    const rankB = b.followUpUrgency ? URGENCY_RANK[b.followUpUrgency] : 2;
    if (rankA !== rankB) return rankA - rankB;
    if (a.daysWaiting !== b.daysWaiting) return b.daysWaiting - a.daysWaiting;
    return a.orgName.localeCompare(b.orgName);
  });
}

/** Rows visible under one scope. Order is preserved. */
export function filterByScope(
  rows: readonly InboxQueueRow[],
  scope: InboxScope,
): InboxQueueRow[] {
  if (scope === "all") return [...rows];
  if (scope === "mine") return rows.filter((row) => row.isMine);
  return rows.filter((row) => !row.isMine);
}

/** Rows in one bucket, or all of them when no bucket is selected. */
export function filterByBucket(
  rows: readonly InboxQueueRow[],
  bucket: InboxQueueBucket | null,
): InboxQueueRow[] {
  if (!bucket) return [...rows];
  return rows.filter((row) => row.bucket === bucket);
}

/**
 * Counts for the scope switcher. Every scope is counted from the same row set,
 * so the three numbers always add up and a CAM can see how much of the team's
 * queue is theirs without changing the view.
 */
export function countByScope(rows: readonly InboxQueueRow[]): Record<InboxScope, number> {
  let mine = 0;
  for (const row of rows) if (row.isMine) mine += 1;
  return { mine, team: rows.length - mine, all: rows.length };
}

/**
 * Counts per bucket within an already-scoped row set, plus `all`. Drives the
 * bucket segments, which is why it counts what is on screen rather than the
 * whole queue — a segment reading 12 that shows 3 rows is worse than no count.
 */
export function countByBucket(
  rows: readonly InboxQueueRow[],
): Record<InboxQueueBucket | "all", number> {
  const counts = { needs_reply: 0, follow_up_due: 0, awaiting_them: 0, all: rows.length };
  for (const row of rows) counts[row.bucket] += 1;
  return counts;
}

/** Narrows an untrusted `?scope=` search param. */
export function parseScope(value: string | undefined | null): InboxScope {
  return INBOX_SCOPES.includes(value as InboxScope) ? (value as InboxScope) : "mine";
}

/** Narrows an untrusted `?bucket=` search param. Null means "no filter". */
export function parseBucket(value: string | undefined | null): InboxQueueBucket | null {
  return INBOX_BUCKETS.includes(value as InboxQueueBucket)
    ? (value as InboxQueueBucket)
    : null;
}
