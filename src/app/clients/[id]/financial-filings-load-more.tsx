"use client";

import { useState, useTransition } from "react";
import { loadMoreFinancialFilings } from "./financial-filings-actions";
import {
  FINANCIAL_FILINGS_PAGE_SIZE,
  FinancialFilingListItem,
  type FinancialFilingRow,
} from "./financial-filing-item";
import { FeedPagination } from "@/components/ui/feed-pagination";

/**
 * The Financial filings section's list + paginator. Owns the loaded-filings state
 * and page navigation with per-page selection and cached pages.
 */
export function FinancialFilingsLoadMore({
  organisationId,
  initialFilings,
  totalCount,
}: {
  organisationId: string;
  initialFilings: readonly FinancialFilingRow[];
  totalCount: number;
}) {
  const [pageSize, setPageSize] = useState<number>(FINANCIAL_FILINGS_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [cache, setCache] = useState<Record<string, readonly FinancialFilingRow[]>>({
    [`1-${FINANCIAL_FILINGS_PAGE_SIZE}`]: initialFilings,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (totalCount === 0 && initialFilings.length === 0) return null;

  const cacheKey = `${currentPage}-${pageSize}`;
  const currentRows =
    cache[cacheKey] ??
    (currentPage === 1 && pageSize === FINANCIAL_FILINGS_PAGE_SIZE ? initialFilings : []);

  function fetchPage(targetPage: number, targetPageSize: number) {
    const key = `${targetPage}-${targetPageSize}`;
    if (cache[key]) {
      setCurrentPage(targetPage);
      setPageSize(targetPageSize);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await loadMoreFinancialFilings({
        organisationId,
        offset: (targetPage - 1) * targetPageSize,
        limit: targetPageSize,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCache((prev) => ({ ...prev, [key]: result.filings }));
      setCurrentPage(targetPage);
      setPageSize(targetPageSize);
    });
  }

  function handlePageChange(page: number) {
    if (page === currentPage || pending) return;
    fetchPage(page, pageSize);
  }

  function handlePageSizeChange(newSize: number) {
    if (newSize === pageSize || pending) return;
    fetchPage(1, newSize);
  }

  return (
    <>
      <ul
        className={`mt-3.5 flex flex-col transition-opacity duration-150 ${
          pending ? "pointer-events-none opacity-50" : "opacity-100"
        }`}
      >
        {currentRows.map((filing) => (
          <FinancialFilingListItem key={filing.id} filing={filing} />
        ))}
      </ul>

      {error && (
        <p className="mt-3 text-xs font-semibold text-stop" role="alert">
          {error}
        </p>
      )}

      <FeedPagination
        totalItems={totalCount}
        pageSize={pageSize}
        currentPage={currentPage}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        pageSizeOptions={[5, 10, 20]}
        className="-mx-5 -mb-4.5 mt-4 rounded-b-panel border-t border-rule bg-paper-sunk/30 px-5 py-3"
      />
    </>
  );
}
