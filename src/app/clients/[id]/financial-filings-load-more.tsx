"use client";

import { useState, useTransition } from "react";
import { loadMoreFinancialFilings } from "./financial-filings-actions";
import {
  FINANCIAL_FILINGS_PAGE_SIZE,
  FinancialFilingListItem,
  type FinancialFilingRow,
} from "./financial-filing-item";

/**
 * The Financial filings section's list + pager. Owns the loaded-filings state
 * so "Load more" can append a page without a full page reload — same pattern
 * as GrantHistoryLoadMore: the initial page is seeded from the server render
 * (state, like TagsSection's initialClientTags), and each click fetches the
 * next page of the identical ordered query via loadMoreFinancialFilings.
 *
 * Renders nothing until there is either a list to show or a button worth
 * showing, so a client with no filings (or one whose whole history fits on the
 * first page) never pays for the interactivity.
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
  const [rows, setRows] = useState<readonly FinancialFilingRow[]>(initialFilings);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasMore = rows.length < totalCount;

  if (rows.length === 0) return null;

  function handleLoadMore() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await loadMoreFinancialFilings({
        organisationId,
        // rows is seeded with the server-rendered first page and only ever
        // grows, so its length is exactly the number of filings already shown
        // — the offset of the next page of the same ordered query.
        offset: rows.length,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRows((current) => [...current, ...result.filings]);
    });
  }

  return (
    <>
      <ul className="mt-4 space-y-3">
        {rows.map((filing) => (
          <FinancialFilingListItem key={filing.id} filing={filing} />
        ))}
      </ul>

      <div className="mt-4 flex flex-col items-start gap-2">
        <p className="text-[12px] text-foreground/40">
          Showing {rows.length} of {totalCount}{" "}
          {totalCount === 1 ? "filing" : "filings"}
        </p>
        {hasMore && (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={pending}
            className="rounded-full bg-brand/12 px-3 py-1.5 text-xs font-bold text-brand-hover hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? "Loading…"
              : `Load ${Math.min(FINANCIAL_FILINGS_PAGE_SIZE, totalCount - rows.length)} more`}
          </button>
        )}
        {error && (
          <p className="text-xs font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
