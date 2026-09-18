import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";

import {
  deriveIncomeBand,
  formatCompactGbp,
  formatGbp,
  INCOME_BAND_LABELS,
  type IncomeBand,
} from "@/lib/income-band";
import {
  filingRecency,
  type FinancialPeriodInput,
  type FinancialSeries,
} from "@/lib/financials/financial-series";
import type { OperatingGeography } from "@/lib/operating-geography";
import type { SectorPeerStats } from "@/lib/financials/sector-peers";
import { IncomeBandScale } from "../income-band-scale";
import { PeopleDial } from "./people-dial";
import { SubSection } from "../section-card";
import { SectorPeerStrip } from "./sector-peer-strip";
import { OperatingReach } from "./operating-reach";

interface FinancialsHeroCardProps {
  /** Every filed period, newest first — not the paginated first page. */
  filings: FinancialPeriodInput[];
  totalCount: number;
  fallbackIncomeBand?: string | null;
  /** Built once on the page and shared with every section. Read here only for
   *  the headcount headline — the balance, the trend and income per head are
   *  section 4's job, and this is the size figure. */
  series: FinancialSeries;
  /** Declared areas of operation. Null where the record is not a charity, or
   *  where the register file is unavailable. */
  geography?: OperatingGeography | null;
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
  geography,
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

  const latestPeriodFormatted = latest?.period_end
    ? new Date(latest.period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  // The newest return that published a headcount, which is not always the
  // newest return — an entry-level filing carries totals only. Same rule as
  // section 4, which is where the balance and the trend live; the dial beside
  // these figures owns the total and how it splits.
  const staffed = [...series.years]
    .reverse()
    .find((year) => year.employees !== null || year.volunteers !== null);

  const recency = filingRecency(
    latest?.period_end ?? null,
    undefined,
    latest?.filing_date ?? null,
  );
  const previous = filings[1] ?? null;
  const previousYear = previous?.period_end
    ? new Date(previous.period_end).getFullYear()
    : null;
  const prevLabel = previousYear ? `FY${String(previousYear).slice(-2)}` : "last year";

  const prevIncome = previous?.total_income ?? null;
  const prevExpenditure = previous?.total_expenditure ?? null;
  const prevNetBalance =
    prevIncome !== null && prevExpenditure !== null
      ? prevIncome - prevExpenditure
      : null;

  const incomeYoY = (() => {
    if (totalIncome === null || prevIncome === null) return null;
    const { pctStr, diff } = formatYoYPercent(totalIncome, prevIncome);
    const compactDiff = diff > 0 ? `+${formatCompactGbp(diff)}` : formatCompactGbp(diff);
    const tone: "go" | "stop" | "dim" = diff > 0 ? "go" : diff < 0 ? "stop" : "dim";
    return {
      pctStr,
      compactDiff,
      diff,
      tone,
      tooltip: `vs ${prevLabel}: ${formatGbp(prevIncome)} (${compactDiff})`,
    };
  })();

  const expenditureYoY = (() => {
    if (totalExpenditure === null || prevExpenditure === null) return null;
    const { pctStr, diff } = formatYoYPercent(totalExpenditure, prevExpenditure);
    const compactDiff = diff > 0 ? `+${formatCompactGbp(diff)}` : formatCompactGbp(diff);
    return {
      pctStr,
      compactDiff,
      diff,
      tooltip: `vs ${prevLabel}: ${formatGbp(prevExpenditure)} (${compactDiff})`,
    };
  })();

  const netYoY = (() => {
    if (netBalance === null || prevNetBalance === null) return null;
    const diff = netBalance - prevNetBalance;
    const compactDiff = diff > 0 ? `+${formatCompactGbp(diff)}` : formatCompactGbp(diff);
    const tone: "go" | "stop" | "dim" = diff > 0 ? "go" : diff < 0 ? "stop" : "dim";
    let pctStr: string | null = null;
    if (prevNetBalance > 0 && netBalance > 0) {
      pctStr = formatYoYPercent(netBalance, prevNetBalance).pctStr;
    }
    return {
      compactDiff,
      pctStr,
      diff,
      tone,
      tooltip: `vs ${prevLabel}: ${prevNetBalance >= 0 ? "+" : ""}${formatGbp(prevNetBalance)} (${compactDiff})`,
    };
  })();

  return (
    <div className="mt-4 space-y-6">
      {/* 1.1 and 1.2 answer "how big" off two different filings, the accounts
          and the annual return's declared areas, so they are numbered parts
          rather than one run of figures. Before this, reach was a hairline rule
          and a sentence set smaller than the caption under Annual Income, which
          for an international charity buried the most telling fact on the tab. */}
      <SubSection
        number="1.1"
        title="Money and people"
        hint="The latest filed year, and the headcount behind it."
      >
        <div className="mt-3.5 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-8 xl:gap-10">
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
                {incomeYoY ? (
                  <p
                    className="mt-0.5 text-[11.5px] text-faint"
                    title={incomeYoY.tooltip}
                  >
                    {incomeYoY.diff === 0 ? (
                      <span className="font-medium text-dim">No change</span>
                    ) : (
                      <>
                        <span
                          className={`font-semibold ${
                            incomeYoY.tone === "go"
                              ? "text-go"
                              : incomeYoY.tone === "stop"
                                ? "text-stop"
                                : "text-dim"
                          }`}
                        >
                          {incomeYoY.pctStr}
                        </span>{" "}
                        <span className="tabular-nums">({incomeYoY.compactDiff})</span>
                      </>
                    )}{" "}
                    vs last year
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11.5px] text-faint">
                    {totalCount > 1 ? "Prior year not reported" : "No prior year data"}
                  </p>
                )}
              </div>

              <div>
                <p className="text-[12.5px] text-dim">Annual Expenditure</p>
                <p className="mt-1 font-mono text-[22px] font-bold tracking-tight text-ink">
                  {formatGbp(totalExpenditure)}
                </p>
                {expenditureYoY ? (
                  <p
                    className="mt-0.5 text-[11.5px] text-faint"
                    title={expenditureYoY.tooltip}
                  >
                    {expenditureYoY.diff === 0 ? (
                      <span className="font-medium text-dim">No change</span>
                    ) : (
                      <>
                        <span className="font-semibold text-dim">
                          {expenditureYoY.pctStr}
                        </span>{" "}
                        <span className="tabular-nums">({expenditureYoY.compactDiff})</span>
                      </>
                    )}{" "}
                    vs last year
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11.5px] text-faint">
                    {totalCount > 1 ? "Prior year not reported" : "No prior year data"}
                  </p>
                )}
              </div>

              <div>
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
                {netYoY ? (
                  <p
                    className="mt-0.5 text-[11.5px] text-faint"
                    title={netYoY.tooltip}
                  >
                    {netYoY.diff === 0 ? (
                      <span className="font-medium text-dim">No change</span>
                    ) : (
                      <>
                        <span
                          className={`font-semibold ${
                            netYoY.tone === "go"
                              ? "text-go"
                              : netYoY.tone === "stop"
                                ? "text-stop"
                                : "text-dim"
                          }`}
                        >
                          {netYoY.compactDiff}
                        </span>
                        {netYoY.pctStr && (
                          <>
                            {" "}
                            <span className="tabular-nums">({netYoY.pctStr})</span>
                          </>
                        )}
                      </>
                    )}{" "}
                    vs last year
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11.5px] text-faint">
                    {totalCount > 1 ? "Prior year not reported" : "No prior year data"}
                  </p>
                )}
              </div>
            </div>

          {/* Size, under the money it is derived from rather than beside it.
              The tier and the peer strip are both full-width horizontal tracks:
              side by side in a narrow rail they each lost about half the length
              they need, and the peer strip in particular is a log axis spanning
              four orders of magnitude — squeezing that is how it stopped being
              readable. Stacked, in the column whose figures they describe. */}
          <div className="border-t border-rule-soft pt-4">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-ink">
                Organisation size tier
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

          {/* People, on the right, because it is the one figure here that is not
              money and reads as a different question. */}
          <div className="w-full shrink-0 lg:w-[320px] xl:w-[360px] lg:border-l lg:border-rule-soft lg:pl-8 xl:pl-10">
            <PeopleDial
              employees={staffed?.employees ?? null}
              volunteers={staffed?.volunteers ?? null}
              year={
                staffed?.periodEnd ? new Date(staffed.periodEnd).getFullYear() : null
              }
            />
          </div>
        </div>
      </SubSection>

      {/* Absent for a company-only record, and for a charity whose return
          declared no areas: the overview card explains that case in full, and
          an empty numbered part would promise something the register does not
          publish. 1.1 keeps its number either way. */}
      {geography && geography.totalAreaCount > 0 && (
        <SubSection
          number="1.2"
          title="Where they Operate"
          hint="The areas this charity declares on its annual return, which is the other half of how big it is."
        >
          <OperatingReach geography={geography} />
        </SubSection>
      )}
    </div>
  );
}

function formatYoYPercent(
  current: number,
  previous: number,
): {
  pctStr: string;
  diff: number;
} {
  const diff = current - previous;
  if (previous === 0) {
    return { pctStr: diff > 0 ? "+100%" : "0%", diff };
  }
  const pct = (diff / previous) * 100;
  const absPct = Math.abs(pct);
  if (absPct < 0.05) {
    return { pctStr: "0.0%", diff };
  }
  const formatted =
    absPct >= 100
      ? Math.round(absPct).toString()
      : (Math.round(absPct * 10) / 10).toFixed(absPct % 1 < 0.05 ? 0 : 1);
  const sign = pct > 0 ? "+" : "-";
  return { pctStr: `${sign}${formatted}%`, diff };
}

