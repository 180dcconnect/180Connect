import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

import {
  deriveIncomeBand,
  formatCompactGbp,
  formatGbp,
  INCOME_BAND_LABELS,
  type IncomeBand,
} from "@/lib/income-band";
import type { FinancialFilingRow } from "../financial-filing-item";
import { IncomeBandScale } from "../income-band-scale";

interface FinancialsHeroCardProps {
  filings: FinancialFilingRow[];
  totalCount: number;
  fallbackIncomeBand?: string | null;
}

export function FinancialsHeroCard({
  filings,
  totalCount,
  fallbackIncomeBand,
}: FinancialsHeroCardProps) {
  const latest = filings[0] ?? null;

  const activeBand: IncomeBand | null =
    latest?.income_band ??
    deriveIncomeBand(latest?.total_income) ??
    (fallbackIncomeBand as IncomeBand | null) ??
    null;

  const totalIncome = latest?.total_income ?? null;
  const totalExpenditure = latest?.total_expenditure ?? null;
  const hasBoth = totalIncome !== null && totalExpenditure !== null;
  const netBalance = hasBoth ? totalIncome - totalExpenditure : null;

  const latestYear = latest?.period_end
    ? new Date(latest.period_end).getFullYear()
    : null;
  const latestPeriodFormatted = latest?.period_end
    ? new Date(latest.period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  // Compute multi-year comparison for trend (up to latest 4 filings, sorted chronologically)
  const sortedChronological = [...filings]
    .filter((f) => f.total_income !== null || f.total_expenditure !== null)
    .slice(0, 4)
    .sort((a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime());

  const maxIncome = Math.max(
    ...sortedChronological.map((f) => f.total_income ?? 0),
    1,
  );

  // YoY growth calculation between the latest two chronological periods
  let yoyGrowth: number | null = null;
  if (sortedChronological.length >= 2) {
    const prior = sortedChronological[sortedChronological.length - 2];
    const curr = sortedChronological[sortedChronological.length - 1];
    if (
      prior.total_income &&
      curr.total_income &&
      prior.total_income > 0
    ) {
      yoyGrowth = Math.round(
        ((curr.total_income - prior.total_income) / prior.total_income) * 100,
      );
    }
  }

  return (
    <div className="rounded-panel border border-rule bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        {/* Left Column: Key Headline Metrics */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
              Latest Filed Accounts{totalCount > 1 ? ` (${totalCount} filed)` : ""}
            </span>
            {latestPeriodFormatted && (
              <span className="font-mono text-[11.5px] text-faint">
                Year ended {latestPeriodFormatted}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[12.5px] text-dim">Annual Income</p>
              <p className="mt-1 font-mono text-[22px] font-bold tracking-tight text-ink">
                {formatGbp(totalIncome)}
              </p>
              {latestYear && (
                <p className="mt-0.5 text-[11.5px] text-faint">FY{String(latestYear).slice(-2)} filing</p>
              )}
            </div>

            <div>
              <p className="text-[12.5px] text-dim">Annual Expenditure</p>
              <p className="mt-1 font-mono text-[22px] font-bold tracking-tight text-ink">
                {formatGbp(totalExpenditure)}
              </p>
              <p className="mt-0.5 text-[11.5px] text-faint">Operating spend</p>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <p className="text-[12.5px] text-dim">Net Annual Position</p>
              {netBalance !== null ? (
                <div className="mt-1 flex items-center gap-1.5">
                  {netBalance >= 0 ? (
                    <TrendingUp aria-hidden="true" className="size-4.5 text-go" />
                  ) : (
                    <TrendingDown aria-hidden="true" className="size-4.5 text-stop" />
                  )}
                  <p
                    className={`font-mono text-[22px] font-bold tracking-tight tabular-nums ${
                      netBalance >= 0 ? "text-go" : "text-stop"
                    }`}
                  >
                    {netBalance >= 0 ? `+${formatGbp(netBalance)}` : `-${formatGbp(Math.abs(netBalance))}`}
                  </p>
                </div>
              ) : (
                <p className="mt-1 font-mono text-[18px] text-faint">Not reported</p>
              )}
              <p className="mt-0.5 text-[11.5px] text-faint">
                {netBalance !== null ? (netBalance >= 0 ? "Net operating surplus" : "Net operating deficit") : "Single filing metric"}
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: 4-Stage Segmented Scale */}
        <div className="w-full lg:max-w-md lg:border-l lg:border-rule-soft lg:pl-6">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink">
              Organisation Size Tier
            </span>
            {activeBand && (
              <span className="rounded-[4px] bg-lead-wash px-2 py-0.5 text-[11px] font-semibold text-lead">
                {INCOME_BAND_LABELS[activeBand]}
              </span>
            )}
          </div>

          <IncomeBandScale
            activeBand={activeBand}
            compact={false}
            periodEnd={latest?.period_end}
            showSummary={true}
            totalIncome={totalIncome}
          />
        </div>
      </div>

      {/* Multi-Year Historical Trend Comparison */}
      {sortedChronological.length >= 2 && (
        <div className="mt-6 border-t border-rule-soft pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink">
              Multi-Year Income History ({sortedChronological.length} filed periods)
            </h3>
            {yoyGrowth !== null && (
              <span
                className={`inline-flex items-center gap-1 font-mono text-[12px] font-medium tabular-nums ${
                  yoyGrowth >= 0 ? "text-go" : "text-stop"
                }`}
              >
                {yoyGrowth >= 0 ? (
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                ) : (
                  <ArrowDownRight aria-hidden="true" className="size-3.5" />
                )}
                {yoyGrowth >= 0 ? `+${yoyGrowth}%` : `${yoyGrowth}%`} latest YoY change
              </span>
            )}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sortedChronological.map((f) => {
              const yearNum = new Date(f.period_end).getFullYear();
              const income = f.total_income ?? 0;
              const barPercent = Math.max(Math.round((income / maxIncome) * 100), 6);
              const band = f.income_band ?? deriveIncomeBand(f.total_income);

              return (
                <div
                  key={f.id}
                  className="rounded-inset border border-rule-soft bg-paper/40 p-3"
                >
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-ink">FY{String(yearNum).slice(-2)}</span>
                    <span className="font-mono text-[11px] text-faint">
                      {band ? INCOME_BAND_LABELS[band] : "—"}
                    </span>
                  </div>

                  <p className="mt-1 font-mono text-[15px] font-bold tabular-nums text-ink">
                    {formatCompactGbp(f.total_income)}
                  </p>

                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-paper-sunk">
                    <div
                      className="h-full rounded-full bg-lead transition-all"
                      style={{ width: `${barPercent}%` }}
                    />
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-dim">
                    <span>Spend: {formatCompactGbp(f.total_expenditure)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
