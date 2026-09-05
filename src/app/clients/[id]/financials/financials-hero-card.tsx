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
import type { OperatingGeography } from "@/lib/operating-geography";
import type { SectorPeerStats } from "@/lib/financials/sector-peers";
import { IncomeBandScale } from "../income-band-scale";
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

  // The newest return that published a headcount, which is not always the
  // newest return — an entry-level filing carries totals only. Same rule as
  // section 4, which is where the balance and the trend live; this is only the
  // size figure, so it stops at one number and its composition.
  const staffed = [...series.years]
    .reverse()
    .find((year) => year.employees !== null || year.volunteers !== null);
  const employees = staffed?.employees ?? null;
  const volunteers = staffed?.volunteers ?? null;
  // A filed zero is a zero and an absent figure is not one, so a return that
  // published 40 volunteers and no staff count gives a headcount of 40 that is
  // a *floor* — the caption says which of the two halves is missing rather than
  // letting the total imply both were filed.
  const people =
    employees === null && volunteers === null ? null : (employees ?? 0) + (volunteers ?? 0);
  const bothFiled = employees !== null && volunteers !== null;
  const volunteerShare =
    bothFiled && people !== null && people > 0 ? volunteers / people : null;

  const peopleCaption =
    people === null
      ? "Not on the filed return"
      : !bothFiled
        ? employees === null
          ? "Volunteers only — no staff figure filed"
          : "Staff only — no volunteer figure filed"
        : volunteers === 0
          ? "All paid staff, no volunteers"
          : employees === 0
            ? "All volunteers, no paid staff"
            : `${Math.round((volunteerShare ?? 0) * 100)}% volunteers`;

  const recency = filingRecency(
    latest?.period_end ?? null,
    undefined,
    latest?.filing_date ?? null,
  );
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
        <div className="mt-3.5 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
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

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                <p className="mt-0.5 text-[11.5px] text-faint">
                  {netBalance !== null ? (netBalance >= 0 ? "Net operating surplus" : "Net operating deficit") : "Single filing metric"}
                </p>
              </div>

              {/* People as a size figure. How many bodies the organisation has is
                  a scale measure in the way income is — and it is the one that
                  tells a £2m charity run by nine people apart from a £2m charity
                  run by two hundred. The paid/unpaid *balance*, the trend and
                  income per head are section 4's questions, so this stops at the
                  total and the one word of composition that makes it legible. */}
              <div>
                <p className="text-[12.5px] text-dim">People</p>
                {people !== null ? (
                  <p className="mt-1 font-mono text-[22px] font-bold tracking-tight tabular-nums text-ink">
                    {people.toLocaleString("en-GB")}
                  </p>
                ) : (
                  <p className="mt-1 font-mono text-[18px] text-faint">Not reported</p>
                )}
                <p className="mt-0.5 text-[11.5px] text-faint">{peopleCaption}</p>
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
