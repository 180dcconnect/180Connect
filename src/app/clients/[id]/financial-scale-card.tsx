import Link from "next/link";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

import {
  deriveIncomeBand,
  formatGbp,
  type IncomeBand,
} from "@/lib/income-band";
import { SectionCard } from "./section-card";
import { IncomeBandScale } from "./income-band-scale";
import type { LatestFinancialRow } from "./load-record";

interface FinancialScaleCardProps {
  organisationId: string;
  financial: LatestFinancialRow | null;
  fallbackIncomeBand?: string | null;
}

export function FinancialScaleCard({
  organisationId,
  financial,
  fallbackIncomeBand,
}: FinancialScaleCardProps) {
  const activeBand: IncomeBand | null =
    (financial?.income_band as IncomeBand | null) ??
    deriveIncomeBand(financial?.total_income) ??
    (fallbackIncomeBand as IncomeBand | null) ??
    null;

  const totalIncome = financial?.total_income ?? null;
  const totalExpenditure = financial?.total_expenditure ?? null;
  const hasBoth = totalIncome !== null && totalExpenditure !== null;
  const netBalance = hasBoth ? totalIncome - totalExpenditure : null;

  const year = financial?.period_end
    ? new Date(financial.period_end).getFullYear()
    : null;
  const periodEndFormatted = financial?.period_end
    ? new Date(financial.period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <SectionCard
      action={
        <Link
          className="group inline-flex items-center gap-1 text-xs font-semibold text-lead hover:underline"
          href={`/clients/${organisationId}/financials`}
        >
          <span>All financials</span>
          <ArrowUpRight
            aria-hidden="true"
            className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </Link>
      }
      headingId="financial-scale-heading"
      hint="Scale and capacity based on filed annual accounts."
      title="Financial scale & tier"
    >
      <div className="mt-3.5 space-y-4">
        {/* The 4-Stage Segmented Range Bar */}
        <IncomeBandScale
          activeBand={activeBand}
          periodEnd={financial?.period_end}
          showSummary={false}
          totalIncome={totalIncome}
        />

        {/* Quick financial snapshot stats */}
        <div className="grid grid-cols-2 gap-2 border-t border-rule-soft pt-3 text-[13px] sm:grid-cols-3">
          <div className="rounded-inset bg-paper/50 p-2.5">
            <p className="text-[11.5px] text-dim">Annual income</p>
            <p className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-ink">
              {formatGbp(totalIncome)}
            </p>
            {year && <p className="text-[11px] text-faint">FY{String(year).slice(-2)}</p>}
          </div>

          <div className="rounded-inset bg-paper/50 p-2.5">
            <p className="text-[11.5px] text-dim">Expenditure</p>
            <p className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-ink">
              {formatGbp(totalExpenditure)}
            </p>
            {periodEndFormatted && (
              <p className="text-[11px] text-faint truncate" title={`Ended ${periodEndFormatted}`}>
                Ended {periodEndFormatted}
              </p>
            )}
          </div>

          <div className="col-span-2 rounded-inset bg-paper/50 p-2.5 sm:col-span-1">
            <p className="text-[11.5px] text-dim">Net position</p>
            {netBalance !== null ? (
              <div className="mt-0.5 flex items-center gap-1 font-mono text-[14px] font-semibold tabular-nums">
                {netBalance >= 0 ? (
                  <>
                    <TrendingUp aria-hidden="true" className="size-3.5 text-go" />
                    <span className="text-go">+{formatGbp(netBalance)}</span>
                  </>
                ) : (
                  <>
                    <TrendingDown aria-hidden="true" className="size-3.5 text-stop" />
                    <span className="text-stop">-{formatGbp(Math.abs(netBalance))}</span>
                  </>
                )}
              </div>
            ) : (
              <p className="mt-0.5 text-[13px] text-faint">Not calculated</p>
            )}
            <p className="text-[11px] text-faint">
              {netBalance !== null ? (netBalance >= 0 ? "Surplus" : "Deficit") : "Single filing"}
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
