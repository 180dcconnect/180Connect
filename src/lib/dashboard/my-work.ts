/**
 * F206 (#201) — "My work": the CAM's own desk, counted off the same
 * organisations rows the platform-wide metrics (F022-F025) are computed from.
 *
 * The dashboard opens on platform totals, which are the right numbers for a
 * standup and the wrong ones for the person who just logged in — a CAM cannot
 * act on "1,794 organisations". These four counts are the same pipeline read
 * scoped to `owner_id = me`, so the first thing on the screen is the work in
 * front of them.
 *
 * Deliberately pure and deliberately free: it reuses the rows the page already
 * fetched, so the strip costs no extra query. It also does NOT report
 * conversions — that number is period-sensitive and already lives in the
 * Performance section's "Just me" scope, and two differently-windowed
 * conversion counts on one screen is how a dashboard starts lying.
 *
 * Every bucket carries the status values it counted, so the count and the link
 * it backs cannot drift apart as the F145 status vocabulary grows.
 *
 * Where a tile goes. The two standing buckets are readings of this CAM's own
 * book, and they open the client list filtered exactly the way the count was
 * taken. The two reply buckets are work you *answer*, so they open the inbox at
 * the tab that already holds it — `Inbound Replies` and `Awaiting Response`.
 * A filtered client list is the wrong door for those: the reply body is in the
 * inbox, so the tile used to land a CAM on a list they had to leave again.
 */
import type { DashboardOrgRow } from "../dashboard-metrics.ts";
import type { InboxCategoryTab } from "../inbox/category-tabs.ts";

/** Statuses where the CAM has sent something and the client has not replied. */
export const AWAITING_REPLY_STATUSES: readonly string[] = [
  "initial_outreach_sent",
  "follow_up_sent",
];

/**
 * Statuses where a reply landed and the CAM has not yet moved the client on.
 * `responded` only — the resolved outcomes (converted, soft_no, hard_no,
 * future_potential, loss_due_timing) have all had their decision made, so
 * counting them as "needs action" would make the tile permanently non-zero and
 * therefore ignorable.
 */
export const NEEDS_ACTION_STATUSES: readonly string[] = ["responded"];

/** Owned but never contacted — the actionable front of the CAM's own funnel. */
export const NOT_STARTED_STATUSES: readonly string[] = ["not_contacted"];

export type MyWorkBucket = {
  key: "owned" | "awaiting_reply" | "needs_action" | "not_started";
  label: string;
  count: number;
  /**
   * The `status` values this bucket counted — and, for the buckets that link
   * into `/clients`, the filter to apply. An empty array is the bucket that
   * means "all of mine" and therefore filters on owner alone.
   */
  statuses: readonly string[];
  /**
   * Whether this bucket has new unread items requiring attention (e.g. unread inbound replies).
   */
  hasNew?: boolean;
  /**
   * Number of new unread items in this bucket, when known.
   */
  newCount?: number;
};

export type MyWorkSummary = {
  /** Total clients owned by this actor — 0 means the strip should not render. */
  owned: number;
  buckets: MyWorkBucket[];
};

export type MyWorkSummaryOptions = {
  /**
   * Organisation IDs whose inbound reply has not yet been viewed/read by this actor.
   * If provided, any owned organisation in `responded` status that is in this set
   * marks `needs_action` ("Inbound replies") as `hasNew: true` with `newCount`.
   */
  unreadOrgIds?: ReadonlySet<string> | null;
};

function countByStatus(rows: readonly DashboardOrgRow[], statuses: readonly string[]): number {
  const wanted = new Set(statuses);
  let total = 0;
  for (const row of rows) {
    if (wanted.has(row.outreach_status)) total += 1;
  }
  return total;
}

/**
 * The four counts, over this actor's owned rows only. Rows already excluded
 * upstream (actively suppressed clients, per F022 AC3) are absent here too,
 * because the caller passes the filtered set.
 */
export function myWorkSummary(
  rows: readonly DashboardOrgRow[],
  actorId: string,
  options?: MyWorkSummaryOptions,
): MyWorkSummary {
  const mine = rows.filter((row) => row.owner_id === actorId);
  const unreadOrgIds = options?.unreadOrgIds;
  const unreadNeedsActionCount = unreadOrgIds
    ? mine.filter(
        (row) => NEEDS_ACTION_STATUSES.includes(row.outreach_status) && unreadOrgIds.has(row.id),
      ).length
    : 0;

  return {
    owned: mine.length,
    buckets: [
      { key: "owned", label: "My clients", count: mine.length, statuses: [] },
      {
        key: "awaiting_reply",
        label: "Awaiting reply",
        count: countByStatus(mine, AWAITING_REPLY_STATUSES),
        statuses: AWAITING_REPLY_STATUSES,
      },
      {
        // The key keeps the pipeline meaning — a reply landed and no decision
        // has been recorded — but the label is the inbox tab this tile opens,
        // because that is the question the CAM is being sent to answer.
        // "Replied — needs action" asked them to decode a status.
        key: "needs_action",
        label: "Inbound replies",
        count: countByStatus(mine, NEEDS_ACTION_STATUSES),
        statuses: NEEDS_ACTION_STATUSES,
        hasNew: unreadNeedsActionCount > 0,
        newCount: unreadNeedsActionCount,
      },
      {
        key: "not_started",
        label: "Not yet contacted",
        count: countByStatus(mine, NOT_STARTED_STATUSES),
        statuses: NOT_STARTED_STATUSES,
      },
    ],
  };
}

/**
 * The two buckets whose work is answered in the inbox, and the tab that holds
 * it. Typed against `InboxCategoryTab`, so renaming an inbox tab is a compile
 * error here rather than a dead link.
 */
const INBOX_TAB_FOR_BUCKET: Partial<Record<MyWorkBucket["key"], InboxCategoryTab>> = {
  awaiting_reply: "awaiting",
  needs_action: "inbound",
};

/**
 * The href a bucket points at: the inbox tab for the reply buckets, otherwise
 * `/clients` with this actor's owner filter and the bucket's statuses.
 */
export function myWorkHref(bucket: MyWorkBucket, actorId: string): string {
  const inboxTab = INBOX_TAB_FOR_BUCKET[bucket.key];
  if (inboxTab) return `/inbox?tab=${inboxTab}`;

  const params = new URLSearchParams();
  params.set("owner", actorId);
  for (const status of bucket.statuses) params.append("status", status);
  return `/clients?${params.toString()}`;
}
