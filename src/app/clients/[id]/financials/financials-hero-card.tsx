import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";

import {
  deriveIncomeBand,
  formatGbp,
  INCOME_BAND_LABELS,
  type IncomeBand,
} from "@/lib/income-band";
import {
  filingRecency,
  type FinancialPeriodInput,
  type FinancialSeries,
} from "@/lib/financials/financial-series";
import type { SectorPeerStats } from "@/lib/financials/sector-peers";
import { IncomeBandScale } from "../income-band-scale";
import { SectorPeerStrip } from "./sector-peer-strip";
import { StaffingRow } from "./staffing-row";

interface FinancialsHeroCardProps {
  /** Every filed period, newest first — not the paginated first page. */
  filings: FinancialPeriodInput[];
  totalCount: number;
  fallbackIncomeBand?: string | null;
  /** Built once on the page and shared with every other section, rather than
   *  rebuilt here — see the note where it used to be constructed. */
  series: FinancialSeries;
  /** The client's own sector, for the peer strip. Null suppresses the strip. */
  sector?: string | null;
  /** Same-sector clients on record, already reduced. Null suppresses the strip. */
  peerStats?: SectorPeerStats | null;
}

export function FinancialsHeroCard({
  filings,
  totalCount,
  fallbackIncomeBand,
  series,
  sector,
  peerStats,
}: FinancialsHeroCardProps) {
  const latest = filings[0] ?? null;

  const activeBand: IncomeBand | null =
    (latest?.income_band as IncomeBand | null | undefined) ??
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

  // The series is built once on the page and handed to every section, so the
  // headline figures here and the charts in sections 2-4 can never be reading
  // two different derivations of the same filings.
  const recency = filingRecency(
    latest?.period_end ?? null,
    undefined,
    latest?.filing_date ?? null,
  );
  return (
    <div className="mt-4">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        {/* Left Column: Key Headline Metrics */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
              Latest filed{totalCount > 1 ? ` of ${totalCount}` : ""}
            </span>
            {latestPeriodFormatted && (
              <span className="font-mono text-[11.5px] text-faint">
                Year ended {latestPeriodFormatted}
                {/* Exact, not inferred. Only the bulk register extract
                    publishes a received date — the API has no endpoint for one
                    — so this appears for a charity imported from the extract
                    and is silently absent for the rest. */}
                {recency?.filedOn && (
                  <>
                    {" · filed "}
                    {new Date(recency.filedOn).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </>
                )}
              </span>
            )}
          </div>

          {/* Filing recency, said where the figure is read. A charity has ten
              months from its year end to file, so accounts up to ~22 months old
              are simply the newest that exist; past that, this income figure
              describes a year that ended nearly two years ago — and the size
              score, the client-list income filter and whoever is sizing an
              approach are all reading it as current. */}
          {recency?.stale && (
            <p className="flex items-start gap-1.5 rounded-inset bg-hold-wash px-2.5 py-1.5 text-[12px] leading-[1.5] text-hold">
              <AlertTriangle aria-hidden="true" className="mt-[1px] size-3.5 shrink-0" />
              <span>
                {recency.label}. Newer accounts may have been filed since — treat
                these figures as a floor, not a current picture.
              </span>
            </p>
          )}

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

          <StaffingRow series={series} />
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

          {/* Directly under the tier, because it answers the question the tier
              raises and cannot: "£420,000 — is that big?" The tier says which
              of four buckets; this says where in our own book. */}
          {sector && peerStats && (
            <SectorPeerStrip
              income={totalIncome}
              sector={sector}
              stats={peerStats}
            />
          )}
        </div>
      </div>

    </div>
  );
}
