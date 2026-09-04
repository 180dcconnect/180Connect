import type { ReactNode } from "react";

import { HandCoins } from "lucide-react";
import { GrantFetchButton } from "./grant-fetch-button";
import { GrantHistoryLoadMore } from "./grant-history-load-more";
import type { GrantRow } from "./grant-list-item";
import { SectionCard } from "./section-card";

/**
 * F035/F092 — Grant history for one client. The grants were promoted from
 * 360Giving raw records (three-sixty-giving.ts) into the GRANTS table; this is
 * the record's read of that data, most recent first (the table's
 * grants_organisation_idx is `(organisation_id, award_date desc)` for exactly
 * this ordering).
 *
 * Readable by every active user via grants_select_active, so no role gating —
 * same as Notes and Attachments. A failed read is reported, never fatal, and
 * degrades to the same error copy the other sections use.
 *
 * Only the first page (GRANT_HISTORY_PAGE_SIZE) is rendered here — a client
 * like British Red Cross holds 200+ grants, and a wall of scrolling is not a
 * record view. GrantHistoryLoadMore owns the list state and fetches later
 * pages through the page-colocated server action. The count pill shows the
 * total on record, not the loaded subset, so the CAM knows the full scope at
 * a glance.
 *
 * The shell stays a server component (same reasoning as AttachmentsSection);
 * only the list, which needs the Load more interaction, crosses the client
 * boundary.
 */
export function GrantHistorySection({
  organisationId,
  grants,
  totalCount,
  error,
  number,
  intro,
}: {
  organisationId: string;
  grants: readonly GrantRow[];
  totalCount: number;
  error: boolean;
  /** Position in the Financials tab's numbered run. Omitted elsewhere. */
  number?: number;
  /**
   * Rendered above the list. The Financials tab puts the grant-share chart
   * here: the chart and the table are the same question — what funding has this
   * client won — and splitting them across two numbers would have made the run
   * longer without making it clearer.
   */
  intro?: ReactNode;
}) {
  return (
    <SectionCard
      headingId="grant-history-heading"
      title={number === undefined ? "Grant history" : "Funding won"}
      hint="Awards recorded from 360Giving — funding this client has received, newest first."
      icon={<HandCoins aria-hidden="true" />}
      number={number}
      action={
        totalCount > 0 ? (
          <span className="rounded-full bg-paper-sunk px-2.5 py-1 font-mono text-[11.5px] font-medium tabular-nums text-dim">
            {totalCount} {totalCount === 1 ? "grant" : "grants"}
          </span>
        ) : undefined
      }
    >
      {intro}
      {error ? (
        <p className="mt-3.5 text-sm font-semibold text-stop" role="alert">
          Grant history could not be loaded. Refresh and try again.
        </p>
      ) : grants.length === 0 ? (
        <p className="mt-3.5 text-sm leading-[1.6] text-faint">
          No previous grants recorded.
        </p>
      ) : (
        <GrantHistoryLoadMore
          organisationId={organisationId}
          initialGrants={grants}
          totalCount={totalCount}
        />
      )}

      {/* Offered even when the read failed: "could not be loaded" is about our
          database, not about 360Giving, and a CAM may still want to fetch. */}
      <GrantFetchButton organisationId={organisationId} hasGrants={totalCount > 0} />
    </SectionCard>
  );
}
