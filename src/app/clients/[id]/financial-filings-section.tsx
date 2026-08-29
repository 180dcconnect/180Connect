import { Landmark } from "lucide-react";
import { FinancialFilingsLoadMore } from "./financial-filings-load-more";
import type { FinancialFilingRow } from "./financial-filing-item";
import { SectionCard } from "./section-card";

/**
 * F041 — Financial filings for one client. Rows in FINANCIAL_PERIODS are the
 * client's filed Charity Commission accounts (latest_income / latest_expenditure
 * promoted from the raw payload — see write-organisations.ts's
 * upsertFinancialPeriod), newest period first, which is exactly the table's
 * financial_periods_organisation_idx ordering.
 *
 * Readable by every active user via financial_periods_select_active, so no
 * role gating — same as Notes and Grants. A failed read is reported, never
 * fatal, and degrades to the same error copy the other sections use.
 *
 * Only the first page (FINANCIAL_FILINGS_PAGE_SIZE) is rendered here, same
 * pagination shape as Grant history — a long-established charity can carry a
 * filing per year for decades. FinancialFilingsLoadMore owns the list state
 * and fetches later pages through the page-colocated server action. The count
 * pill shows the total on record, not the loaded subset.
 *
 * The shell stays a server component; only the list, which needs the Load more
 * interaction, crosses the client boundary.
 */
export function FinancialFilingsSection({
  organisationId,
  filings,
  totalCount,
  error,
}: {
  organisationId: string;
  filings: readonly FinancialFilingRow[];
  totalCount: number;
  error: boolean;
}) {
  return (
    <SectionCard
      headingId="financial-filings-heading"
      title="Financial filings"
      hint="Filed Charity Commission accounts — this client's reported income and expenditure, newest first."
      icon={<Landmark aria-hidden="true" />}
      action={
        totalCount > 0 ? (
          <span className="rounded-full bg-brand/10 px-3 py-1.5 text-[12px] font-bold tabular-nums text-brand-hover">
            {totalCount} {totalCount === 1 ? "filing" : "filings"}
          </span>
        ) : undefined
      }
    >
      {error ? (
        <p className="mt-4 text-sm font-bold text-destructive" role="alert">
          Financial filings could not be loaded. Refresh and try again.
        </p>
      ) : filings.length === 0 ? (
        <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
          No financial filings recorded.
        </p>
      ) : (
        <FinancialFilingsLoadMore
          organisationId={organisationId}
          initialFilings={filings}
          totalCount={totalCount}
        />
      )}
    </SectionCard>
  );
}
