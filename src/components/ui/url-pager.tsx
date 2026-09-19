"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageSizeSelect, PagingSummary } from "@/components/ui/list-pager";
import { PAGE_SIZE_CHOICES, pageSummary } from "@/lib/pagination";

/**
 * Paging for a list the *database* windows, not the browser.
 *
 * `useListPager` holds the whole list in memory and slices it, which is right
 * for a queue of thirty. It is wrong for a history that only grows: the import
 * runs, the AI generation log, the audit trail. Those pages ask for one window
 * at a time, so the page number has to live in the URL — which is also what
 * makes a filtered, paged view something a reader can send to someone else.
 *
 * Both pieces write to the same two parameters, `page` and `pageSize`, and the
 * server page reads them back. That contract is the whole component; the look
 * comes from `list-pager.tsx`, so a database-paged list and an in-memory one
 * are the same object to a reader.
 *
 * Changing the size drops `page`: page 4 of 10-per-page is a different set of
 * rows from page 4 of 50, and keeping the number lands the reader somewhere
 * they did not ask for. Both also drop any cursor-style parameter a caller
 * names in `resetParams`, for pages that carry one.
 */

function useParamWriter(resetParams: readonly string[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    for (const name of resetParams) params.delete(name);
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  };
}

/** "Show 10 per page" — belongs on the card's heading row, beside the title. */
export function UrlPageSize({
  pageSize,
  pageSizeOptions = PAGE_SIZE_CHOICES,
  resetParams = [],
  className = "",
}: {
  pageSize: number;
  pageSizeOptions?: readonly number[];
  /** Extra parameters to clear when the size changes (a cursor, say). */
  resetParams?: readonly string[];
  className?: string;
}) {
  const write = useParamWriter(resetParams);

  return (
    <PageSizeSelect
      pageSize={pageSize}
      pageSizeOptions={pageSizeOptions}
      className={className}
      onChange={(nextSize) =>
        write((params) => {
          params.set("pageSize", String(nextSize));
          params.delete("page");
        })
      }
    />
  );
}

/**
 * "Showing 1 to 50 of 1,284", the chevrons, and — once the list is long enough
 * to make stepping silly — a box to type a page number into.
 *
 * `totalItems` is the count for the filters in force, not the rows on screen. A
 * pager that counts only what it is showing tells the reader they have seen
 * everything, which on a history that outgrew its window is never true.
 */
export function UrlPagingSummary({
  totalItems,
  page,
  pageSize,
  resetParams = [],
  className = "",
}: {
  totalItems: number;
  page: number;
  pageSize: number;
  resetParams?: readonly string[];
  className?: string;
}) {
  const write = useParamWriter(resetParams);

  return (
    <PagingSummary
      summary={pageSummary(totalItems, page, pageSize)}
      className={className}
      onPageChange={(nextPage) =>
        write((params) => {
          if (nextPage <= 1) params.delete("page");
          else params.set("page", String(nextPage));
        })
      }
    />
  );
}
