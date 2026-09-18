/**
 * The Admin Duty Queue is an actual queue: the whole pool of admin workspaces
 * ranked by backlog, biggest first, with zero-count queues filling the rest so
 * the tile always shows the same number of entries.
 *
 * Pure and tested by `node --test`; the component in
 * `src/components/dashboard/admin-action-center.tsx` builds the pool and this
 * decides the order.
 */

/** How many tiles the duty queue shows at any time. */
export const DUTY_QUEUE_SIZE = 6;

export type DutyQueueEntry = {
  title: string;
  count: number;
  href: string;
  description: string;
};

/**
 * Biggest backlog first. Ties break alphabetically by title so the order is
 * stable between loads — a queue jumping places on equal counts reads as the
 * numbers moving when they have not.
 */
export function topDutyQueues(entries: readonly DutyQueueEntry[]): DutyQueueEntry[] {
  return [...entries]
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, DUTY_QUEUE_SIZE);
}
