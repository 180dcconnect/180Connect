"use client";

import { Award, HeartHandshake, ShieldAlert } from "lucide-react";

import { formatGbp } from "@/lib/income-band";
import type { SpendEfficiencySummary } from "@/lib/financials/spend-efficiency";

import { HorizontalStickGauge } from "@/components/ui/horizontal-stick-gauge";
import { Legend } from "./chart-parts";

export function SpendEfficiencyCard({
  summary,
}: {
  summary: SpendEfficiencySummary;
}) {
  const {
    yearLabel,
    totalExpenditure,
    charitableSpend,
    fundraisingSpend,
    governanceSpend,
    otherSpend,
    charitablePct,
    fundraisingPct,
    governancePct,
    otherPct,
    charitablePence,
    fundraisingPence,
    governancePence,
    otherPence,
    category,
    tone,
    headline,
    insight,
  } = summary;

  const CategoryIcon =
    category === "high_efficiency"
      ? Award
      : category === "high_fundraising_cost"
        ? ShieldAlert
        : HeartHandshake;

  const segments = [
    {
      id: "charitable",
      label: "Direct cause & services",
      value: charitablePence,
      color: "#067647",
      hoverColor: "#05603a",
    },
    {
      id: "fundraising",
      label: "Generating voluntary funds",
      value: fundraisingPence,
      color: "#b54708",
      hoverColor: "#d97706",
    },
    {
      id: "governance",
      label: "Governance & support",
      value: governancePence,
      color: "var(--lead-mid)",
      hoverColor: "var(--lead)",
    },
    ...(otherPence > 0
      ? [
          {
            id: "other",
            label: "Other expenditure",
            value: otherPence,
            color: "var(--rule)",
            hoverColor: "var(--dim)",
          },
        ]
      : []),
  ].filter((s) => s.value > 0);

  return (
    <div className="rounded-panel border border-rule-soft bg-paper/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <CategoryIcon
            aria-hidden="true"
            className={`size-4 shrink-0 ${
              tone === "go" ? "text-go" : tone === "hold" ? "text-hold" : "text-lead"
            }`}
          />
          <h3 className="text-[14px] font-semibold text-ink">Where every £1 goes</h3>
        </div>
        <span className="font-mono text-[11.5px] text-faint">
          {yearLabel} filed accounts ({formatGbp(totalExpenditure)} total spend)
        </span>
      </div>

      {/* Segmented £1 allocation stick gauge */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <Legend
            items={[
              { colour: "#067647", label: `Direct cause (${charitablePence}p)` },
              { colour: "#b54708", label: `Fundraising (${fundraisingPence}p)` },
              { colour: "var(--lead-mid)", label: `Governance (${governancePence}p)` },
              ...(otherPence > 0 ? [{ colour: "var(--rule)", label: `Other (${otherPence}p)` }] : []),
            ]}
          />
        </div>
        <HorizontalStickGauge
          segments={segments}
          pitch={8.5}
          stickWidth={3}
          stickHeight={16}
          valueFormatter={(val) => `${val}p in £1`}
          ariaLabel="Expenditure allocation per pound: direct cause, fundraising, and governance"
        />
      </div>

      {/* 3 Metric Cards for the Three Buckets */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Cause */}
        <div className="rounded-inset border border-rule-soft/60 bg-paper/60 p-3.5">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-go" />
            <p className="text-[12px] font-medium text-dim">Direct cause & services</p>
          </div>
          <p className="mt-2 font-mono text-[22px] font-bold tracking-tight text-ink">
            {charitablePence}p{" "}
            <span className="text-[12px] font-normal text-faint">in £1</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-faint">
            {formatGbp(charitableSpend)} ({charitablePct.toFixed(1)}%)
          </p>
        </div>

        {/* Fundraising */}
        <div className="rounded-inset border border-rule-soft/60 bg-paper/60 p-3.5">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[#b54708]" />
            <p className="text-[12px] font-medium text-dim">Generating voluntary funds</p>
          </div>
          <p className="mt-2 font-mono text-[22px] font-bold tracking-tight text-ink">
            {fundraisingPence}p{" "}
            <span className="text-[12px] font-normal text-faint">in £1</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-faint">
            {formatGbp(fundraisingSpend)} ({fundraisingPct.toFixed(1)}%)
          </p>
        </div>

        {/* Governance */}
        <div className="rounded-inset border border-rule-soft/60 bg-paper/60 p-3.5">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-lead-mid" />
            <p className="text-[12px] font-medium text-dim">Governance & support</p>
          </div>
          <p className="mt-2 font-mono text-[22px] font-bold tracking-tight text-ink">
            {governancePence > 0 ? `${governancePence}p` : otherPence > 0 ? `${otherPence}p` : "—"}{" "}
            <span className="text-[12px] font-normal text-faint">in £1</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-faint">
            {formatGbp(governanceSpend > 0 ? governanceSpend : otherSpend)} (
            {(governancePct > 0 ? governancePct : otherPct).toFixed(1)}%)
          </p>
        </div>
      </div>

      {/* Strategic / Consulting takeaway */}
      <div className="mt-3.5 rounded-inset bg-paper px-3 py-2 text-[12px] leading-[1.5] text-dim">
        <span className="font-semibold text-ink">Efficiency Takeaway: </span>
        <span>{headline}. </span>
        <span>{insight}</span>
      </div>
    </div>
  );
}
