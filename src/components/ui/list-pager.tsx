"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PAGE_SIZE_CHOICES,
  paginate,
  pagingIsUseful,
  type PageSlice,
} from "@/lib/pagination";

/**
 * The top-of-list pager, in three pieces so a list can put each one where it
 * belongs rather than where a footer forces it.
 *
 * WHY AT THE TOP. These lists are read downwards and answered as they are read —
 * the request waiting for a decision, the disagreement waiting for a source to be
 * chosen. A control under the last row is a control the reader has to finish the
 * page to reach, and on the queue screens the reader is deciding as they go, so
 * the page-size choice and the position belong above the first row, where the
 * card's own title already is.
 *
 * WHY THREE PIECES. "Show 10 per page" belongs on the card's heading row, beside
 * the title and the pill — it is a property of the card. "Showing 1 to 10 of 13"
 * belongs on its own line at the top of the body, under that heading. Keeping them
 * in one component would mean either a control too far from the title or a count
 * stranded in a corner, so the pieces are separate and every caller arranges them
 * the same way. Where a list has no card heading of its own — the CAM request
 * queue is an `h2` over cards — both go in one row, which is what `PagerRow` is.
 *
 * The state is `useListPager`, because four lists on two screens page the same
 * way and the clamping rule (see `src/lib/pagination.ts`) should not be written
 * four times.
 */

export type ListPager<T> = PageSlice<T> & {
  /** Move to a page. Clamped on the next render, not rejected here. */
  setPage: (page: number) => void;
  /** Change how many rows are shown, returning to page one. */
  setPageSize: (pageSize: number) => void;
  /** Whether the list is long enough for a page-size control to mean anything. */
  showPager: boolean;
};

/**
 * Paging state for a list held in memory.
 *
 * Changing the page size returns to page one: page 4 of 5-per-page is a different
 * set of rows from page 4 of 20, and keeping the number would land the reader
 * somewhere they did not ask for.
 *
 * THE STORED PAGE MAY DRIFT PAST THE END, and that is deliberate. A list shrinking
 * underneath the reader — a request answered, a suppression lifted — can leave the
 * number pointing past the last page, and `paginate` clamps it back for every value
 * that is rendered or acted on. The buttons read their enabled state from the
 * clamped page too, so nothing offers a move that leads nowhere: the reader sees
 * the last real page, both chevrons agree about where they are, and the number
 * catches up on the next click. Writing the clamp back into state would mean a
 * `setState` in an effect for a case that corrects itself.
 */
export function useListPager<T>(
  items: readonly T[],
  initialPageSize: number = 10,
  pageSizeOptions: readonly number[] = PAGE_SIZE_CHOICES,
): ListPager<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const slice = paginate(items, page, pageSize);

  return {
    ...slice,
    setPage,
    setPageSize: (nextSize: number) => {
      setPageSizeState(nextSize);
      setPage(1);
    },
    showPager: pagingIsUseful(slice.totalItems, pageSizeOptions),
  };
}

/**
 * "Show 10 per page" — the control that belongs on the heading row. Renders
 * nothing of its own that cannot be read: the sizes are the client-facing ones
 * from `PAGE_SIZE_CHOICES`, never a number the reader has to know.
 */
export function PageSizeSelect({
  pageSize,
  onChange,
  pageSizeOptions = PAGE_SIZE_CHOICES,
  disabled = false,
  className = "",
}: {
  pageSize: number;
  onChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 text-[12.5px] text-dim ${className}`}
    >
      <span>Show</span>
      <Select
        value={String(pageSize)}
        onValueChange={(value) => onChange(Number(value))}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="Rows shown per page"
          className="h-7 w-auto min-w-[58px] gap-1 rounded-full border-rule bg-white px-2.5 text-[12px] text-ink"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {pageSizeOptions.map((size) => (
            <SelectItem key={size} value={String(size)} className="text-[12.5px]">
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span>per page</span>
    </div>
  );
}

/**
 * "Showing 1 to 10 of 13", with the chevrons that move the window.
 *
 * The count is the point. Every list this sits on is one that only grows — a
 * decision history nothing leaves — so the reader has to be able to see how much
 * of it they are looking at; a pager without the count reads as though the page
 * is all there is. The chevrons carry text for screen readers and the position
 * ("Page 2 of 4") for everyone else, because a pair of arrows alone does not say
 * how far through the list you are.
 */
export function PagingSummary({
  summary,
  onPageChange,
  className = "",
}: {
  summary: { page: number; totalPages: number; from: number; to: number; totalItems: number };
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const { page, totalPages, from, to, totalItems } = summary;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[12.5px] text-dim ${className}`}
    >
      <p aria-live="polite" className="tabular-nums">
        Showing{" "}
        <span className="font-semibold text-ink">{from}</span> to{" "}
        <span className="font-semibold text-ink">{to}</span> of{" "}
        <span className="font-semibold text-ink">{totalItems}</span>
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-inset text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dim"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <span className="px-1 tabular-nums text-faint">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-inset text-dim transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-lead/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dim"
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Both pieces in one row, for a list with no card heading of its own: the count
 * on the left where the reader starts, the page size on the right.
 */
export function PagerRow({
  summary,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_CHOICES,
  className = "",
}: {
  summary: { page: number; totalPages: number; from: number; to: number; totalItems: number };
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}
    >
      <PagingSummary summary={summary} onPageChange={onPageChange} />
      <PageSizeSelect
        pageSize={pageSize}
        onChange={onPageSizeChange}
        pageSizeOptions={pageSizeOptions}
      />
    </div>
  );
}
