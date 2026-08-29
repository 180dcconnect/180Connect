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

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function FinancialFilingListItem({ filing }: { filing: FinancialFilingRow }) {
  const bandLabel = filing.income_band ? INCOME_BAND_LABELS[filing.income_band] : null;
  return (
    <li className="rounded-xl border border-black/[0.06] p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 truncate text-sm font-bold text-foreground/80">
          Financial year {formatDate(filing.period_end)}
        </p>
        <p className="shrink-0 text-[12px] text-foreground/45">
          {formatDate(filing.period_start)} – {formatDate(filing.period_end)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-[13px] text-foreground/60">
          Income{" "}
          <span className="font-black tabular-nums text-foreground/85">
            {formatAmount(filing.total_income)}
          </span>
        </p>
        <p className="text-[13px] text-foreground/60">
          Expenditure{" "}
          <span className="font-black tabular-nums text-foreground/85">
            {formatAmount(filing.total_expenditure)}
          </span>
        </p>
      </div>
      <p className="mt-1 text-[12px] text-foreground/40">
        {formatSource(filing.financial_source)}
        {bandLabel ? ` · ${bandLabel} income band` : ""}
        {filing.filing_date ? ` · filed ${formatDate(filing.filing_date)}` : ""}
      </p>
    </li>
  );
}
