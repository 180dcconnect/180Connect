"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageSizeSelect, PagingSummary } from "@/components/ui/list-pager";
import { GENERATION_PAGE_SIZES } from "@/lib/outreach/generation-search";
import { pageSummary } from "@/lib/pagination";

/**
 * Paging for the one list the *database* pages, not the browser.
 *
 * The history rows each carry a full prompt and output, so the page asks for one
 * window at a time and these controls say which window. Both write to the URL
 * rather than to state, which is what makes a filtered view linkable — and why
 * they are separate from the in-memory pager the admin queues use.
 *
 * Two pieces, placed where the card wants them: the page size on the heading row
 * beside the title, the count and the chevrons on the first line of the body.
 *
 * Changing the size drops `page`: page 4 of 5-per-page is a different set of rows
 * from page 4 of 20, and keeping the number would land the reader somewhere they
 * did not ask for.
 */

export function HistoryPageSize({ pageSize }: { pageSize: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handlePageSizeChange(nextSize: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", String(nextSize));
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <PageSizeSelect
      pageSize={pageSize}
      onChange={handlePageSizeChange}
      pageSizeOptions={[...GENERATION_PAGE_SIZES]}
    />
  );
}

export function HistoryPagingSummary({
  totalItems,
  page,
  pageSize,
}: {
  totalItems: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handlePageChange(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <PagingSummary
      summary={pageSummary(totalItems, page, pageSize)}
      onPageChange={handlePageChange}
    />
  );
}
