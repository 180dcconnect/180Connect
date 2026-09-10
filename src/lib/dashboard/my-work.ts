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
 * Every bucket carries the status values it counted so the UI can link straight
 * into `/clients?owner=<id>&status=…`, rather than the two lists drifting apart
 * as the F145 status vocabulary grows.
 */
import type { DashboardOrgRow } from "../dashboard-metrics.ts";

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
   * `status` values for the client-list link, or an empty array for the bucket
   * that means "all of mine" and therefore filters on owner alone.
   */
  statuses: readonly string[];
};

export type MyWorkSummary = {
  /** Total clients owned by this actor — 0 means the strip should not render. */
  owned: number;
  buckets: MyWorkBucket[];
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
): MyWorkSummary {
  const mine = rows.filter((row) => row.owner_id === actorId);

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
        key: "needs_action",
        label: "Replied — needs action",
        count: countByStatus(mine, NEEDS_ACTION_STATUSES),
        statuses: NEEDS_ACTION_STATUSES,
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

/** The `/clients` href a bucket points at, owner filter always applied. */
export function myWorkHref(bucket: MyWorkBucket, actorId: string): string {
  const params = new URLSearchParams();
  params.set("owner", actorId);
  for (const status of bucket.statuses) params.append("status", status);
  return `/clients?${params.toString()}`;
}
