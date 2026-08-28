import { HandCoins } from "lucide-react";
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
}: {
  organisationId: string;
  grants: readonly GrantRow[];
  totalCount: number;
  error: boolean;
}) {
  return (
    <SectionCard
      headingId="grant-history-heading"
      title="Grant history"
      hint="Awards recorded from 360Giving — funding this client has received, newest first."
      icon={<HandCoins aria-hidden="true" />}
      action={
        totalCount > 0 ? (
          <span className="rounded-full bg-brand/10 px-3 py-1.5 text-[12px] font-bold tabular-nums text-brand-hover">
            {totalCount} {totalCount === 1 ? "grant" : "grants"}
          </span>
        ) : undefined
      }
    >
      {error ? (
        <p className="mt-4 text-sm font-bold text-destructive" role="alert">
          Grant history could not be loaded. Refresh and try again.
        </p>
      ) : grants.length === 0 ? (
        <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
          No previous grants recorded.
        </p>
      ) : (
        <GrantHistoryLoadMore
          organisationId={organisationId}
          initialGrants={grants}
          totalCount={totalCount}
        />
      )}
    </SectionCard>
  );
}
