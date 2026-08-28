"use client";

import { useState, useTransition } from "react";
import { loadMoreGrants } from "./grant-history-actions";
import { GRANT_HISTORY_PAGE_SIZE, GrantListItem, type GrantRow } from "./grant-list-item";

/**
 * F035 — the Grant history section's list + pager. Owns the loaded-grants
 * state so "Load more" can append a page without a full page reload: the
 * initial page is seeded from the server render (state, same pattern as
 * TagsSection's initialClientTags), and each click fetches the next page of
 * the identical ordered query via loadMoreGrants.
 *
 * Renders nothing until there is either a list to show or a button worth
 * showing, so a client with zero grants (or one whose whole list fits on the
 * first page) never pays for the interactivity.
 */
export function GrantHistoryLoadMore({
  organisationId,
  initialGrants,
  totalCount,
}: {
  organisationId: string;
  initialGrants: readonly GrantRow[];
  totalCount: number;
}) {
  const [rows, setRows] = useState<readonly GrantRow[]>(initialGrants);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasMore = rows.length < totalCount;

  if (rows.length === 0) return null;

  function handleLoadMore() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await loadMoreGrants({
        organisationId,
        // rows is seeded with the server-rendered first page and only ever
        // grows, so its length is exactly the number of grants already shown
        // — the offset of the next page of the same ordered query.
        offset: rows.length,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRows((current) => [...current, ...result.grants]);
    });
  }

  return (
    <>
      <ul className="mt-4 space-y-3">
        {rows.map((grant) => (
          <GrantListItem key={grant.id} grant={grant} />
        ))}
      </ul>

      <div className="mt-4 flex flex-col items-start gap-2">
        <p className="text-[12px] text-foreground/40">
          Showing {rows.length} of {totalCount} {totalCount === 1 ? "grant" : "grants"}
        </p>
        {hasMore && (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={pending}
            className="rounded-full bg-brand/12 px-3 py-1.5 text-xs font-bold text-brand-hover hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Loading…" : `Load ${Math.min(GRANT_HISTORY_PAGE_SIZE, totalCount - rows.length)} more`}
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
