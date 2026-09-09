import { INCOME_BAND_LABELS, type IncomeBand } from "@/lib/income-band";
import { formatSource } from "../../admin/import-status/run-format";

/**
 * One filed financial period's markup + formatting, shared between the
 * server-rendered FinancialFilingsSection and the client-side
 * FinancialFilingsLoadMore pager so the two can never drift apart. No
 * directive on purpose — same reasoning as grant-list-item.tsx.
 *
 * Amounts are formatted with Intl.NumberFormat (identical on server and
 * browser). UK charity accounts are always filed in GBP, so the currency is
 * pinned rather than read from a row the way grant amounts carry their own.
 */
export type FinancialFilingRow = {
  id: string;
  period_start: string;
  period_end: string;
  total_income: number | null;
  total_expenditure: number | null;
  income_band: IncomeBand | null;
  filing_date: string | null;
  financial_source: "charitybase" | "charity_commission";
};

/**
 * How many filings the client detail page renders before asking for more.
 * Kept here, not in the "use server" action file, because Next.js only allows
 * async-function exports from a "use server" module — and the client-side
 * pager needs the number for its "Load N more" label.
 */
export const FINANCIAL_FILINGS_PAGE_SIZE = 10;

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function formatAmount(amount: number | null): string {
  return amount === null ? "Not disclosed" : GBP.format(amount);
}

import { formatShortDate } from "@/lib/display-format";

export function FinancialFilingListItem({ filing }: { filing: FinancialFilingRow }) {
  const bandLabel = filing.income_band ? INCOME_BAND_LABELS[filing.income_band] : null;
  return (
    <li className="border-t border-rule-soft py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 truncate text-[13.5px] font-medium text-ink">
          Year ending {formatShortDate(filing.period_end)}
        </p>
        <p className="shrink-0 font-mono text-[12px] text-faint tabular-nums">
          {formatShortDate(filing.period_start)} – {formatShortDate(filing.period_end)}
        </p>
      </div>
      <div className="mt-1.5 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <p className="flex items-baseline justify-between gap-3 text-[13px] text-dim">
          Income
          <span className="font-mono font-medium tabular-nums text-ink">
            {formatAmount(filing.total_income)}
          </span>
        </p>
        <p className="flex items-baseline justify-between gap-3 text-[13px] text-dim">
          Expenditure
          <span className="font-mono font-medium tabular-nums text-ink">
            {formatAmount(filing.total_expenditure)}
          </span>
        </p>
      </div>
      <p className="mt-1.5 text-[12px] text-faint">
        {formatSource(filing.financial_source)}
        {bandLabel ? ` · ${bandLabel} income band` : ""}
        {filing.filing_date ? ` · filed ${formatShortDate(filing.filing_date)}` : ""}
      </p>
    </li>
  );
}
