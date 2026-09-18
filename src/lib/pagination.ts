/**
 * Paging arithmetic — the numbers behind every "Showing 1 to 10 of 13" line.
 *
 * These lists are read, not scrolled: a queue of clients waiting on a decision
 * and a history of decisions already made are both things an admin counts, so the
 * count and the window have to come from one calculation. Deriving `from`, `to`
 * and `totalPages` at each call site is how two of them end up disagreeing — the
 * line says "of 12" while the list shows 15 rows — so they live here once.
 *
 * Two entry points, deliberately:
 *
 * - `paginate` — the window over rows this browser already holds (the client
 *   queue, the suppression lists, the outcome breakdown). Everything is in
 *   memory; slicing is free.
 * - `pageSummary` — the same arithmetic from a count alone, for the one list the
 *   *database* pages (the AI generation history, where each row carries a full
 *   prompt and output). That page never holds the rows it is not showing, so it
 *   cannot call `paginate`; it must be able to ask the same questions of a number.
 *
 * Both clamp rather than refuse. A page past the end (the reader was on page 3
 * when the last row on it was decided) resolves to the last real page, because a
 * list that answers a stale page number with an empty box reads as a broken list.
 */

/**
 * The sizes offered by default, smallest first.
 *
 * 5 / 10 / 15 / 20 rather than the 25 / 50 the older lists use: these are lists
 * of clients and decisions, each row something to think about rather than a line
 * to skim, and the queues only ever grow — the smallest useful page keeps the
 * whole thing reachable instead of printing a wall of it.
 */
export const PAGE_SIZE_CHOICES = [5, 10, 15, 20] as const;

/** Where a window sits in a list, without the rows. */
export type PageSummary = {
  /** The page actually shown: 1-based, clamped to the last page that exists. */
  page: number;
  /** The page size actually used, floored to a whole positive number of rows. */
  pageSize: number;
  totalItems: number;
  /** At least 1, so "page 1 of 1" is a page the reader can be on. */
  totalPages: number;
  /** 1-based position of the first row shown. 0 when the list is empty. */
  from: number;
  /** 1-based position of the last row shown. 0 when the list is empty. */
  to: number;
};

/**
 * The window for a known count. `items` is deliberately absent — this is what a
 * database-paged list needs, and what the "Showing …" line is rendered from.
 */
export function pageSummary(
  totalItems: number,
  page: number,
  pageSize: number,
): PageSummary {
  const count = Math.max(0, Math.floor(totalItems) || 0);
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const totalPages = Math.max(1, Math.ceil(count / size));
  const requested = Math.floor(page) || 1;
  const safePage = Math.min(Math.max(1, requested), totalPages);
  const start = (safePage - 1) * size;
  return {
    page: safePage,
    pageSize: size,
    totalItems: count,
    totalPages,
    from: count === 0 ? 0 : start + 1,
    to: Math.min(start + size, count),
  };
}

/** The window plus the rows in it. */
export type PageSlice<T> = PageSummary & { items: T[] };

/**
 * The window over rows held in memory. A page size larger than the list is not an
 * error — it simply means one page — which is why the page-size control is hidden
 * rather than disabled when everything fits (see `pagingIsUseful`).
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): PageSlice<T> {
  const summary = pageSummary(items.length, page, pageSize);
  const start = (summary.page - 1) * summary.pageSize;
  return {
    ...summary,
    items: items.slice(start, start + summary.pageSize),
  };
}

/**
 * Whether a page-size control is worth drawing at all.
 *
 * A list shorter than the smallest size on offer has nothing to page, and a
 * control that can only ever show everything is noise on a card that already has
 * a title, a hint and a pill. The count line is still worth having — it is how the
 * reader knows the list is complete — so callers keep drawing what `pageSummary`
 * gives them and use this only to decide whether to offer the control.
 */
export function pagingIsUseful(
  totalItems: number,
  pageSizeOptions: readonly number[] = PAGE_SIZE_CHOICES,
): boolean {
  if (totalItems <= 0) return false;
  const smallest = pageSizeOptions.length > 0 ? Math.min(...pageSizeOptions) : 1;
  return totalItems > smallest;
}
