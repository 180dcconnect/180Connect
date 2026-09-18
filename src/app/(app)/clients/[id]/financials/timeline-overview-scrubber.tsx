"use client";

import { useId, useMemo, useState } from "react";

import type { FinancialYear } from "@/lib/financials/financial-series";
import {
  calculateTimelineOverviewPoints,
  type TrendMetric,
} from "@/lib/financials/timeline-overview";
import { INCOME } from "./chart-parts";

export type { TrendMetric };

interface TimelineOverviewScrubberProps {
  years: FinancialYear[];
  hovered?: number | null;
  onHover?: (index: number | null) => void;
  className?: string;
}

/**
 * A multi-year trajectory overview strip for Section 2 (Track record).
 */
export function TimelineOverviewScrubber({
  years,
  className = "",
}: TimelineOverviewScrubberProps) {
  const gradientId = useId().replace(/:/g, "");
  const [metric, setMetric] = useState<TrendMetric>("income");

  const length = years.length;

  // Calculate curve points based on active metric
  const { curvePoints, splineLine, splineFill, zeroYPercent } = useMemo(
    () => calculateTimelineOverviewPoints(years, metric),
    [years, metric],
  );

  if (length < 2) return null;

  return (
    <div className={`select-none ${className}`}>
      {/* Top Controls Row: metric switch tab group */}
      <div className="flex items-center pb-2">
        <div
          role="tablist"
          aria-label="Metric view"
          className="inline-flex items-center rounded-inset bg-paper-sunk/70 p-0.5 border border-rule-soft/60"
        >
          <button
            type="button"
            role="tab"
            aria-selected={metric === "income"}
            onClick={() => setMetric("income")}
            className={`rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-all ${
              metric === "income"
                ? "bg-white text-ink font-semibold shadow-xs border border-rule-soft/60"
                : "text-dim hover:text-ink"
            }`}
          >
            Income
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={metric === "net"}
            onClick={() => setMetric("net")}
            className={`rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-all ${
              metric === "net"
                ? "bg-white text-ink font-semibold shadow-xs border border-rule-soft/60"
                : "text-dim hover:text-ink"
            }`}
          >
            Net result
          </button>
        </div>
      </div>

      {/* Main Track with Sparkline */}
      <div className="relative h-[48px] sm:h-[54px] w-full overflow-hidden rounded-inset bg-white border border-rule-soft">
        {/* SVG Sparkline Curve & Subtle Area Fill */}
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id={`${gradientId}-income-wash`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={INCOME} stopOpacity={0.16} />
              <stop offset="80%" stopColor={INCOME} stopOpacity={0.03} />
              <stop offset="100%" stopColor={INCOME} stopOpacity={0} />
            </linearGradient>
            <linearGradient
              id={`${gradientId}-lead-wash`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="#23407a" stopOpacity={0.14} />
              <stop offset="80%" stopColor="#23407a" stopOpacity={0.03} />
              <stop offset="100%" stopColor="#23407a" stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Zero baseline for net mode */}
          {zeroYPercent !== null && (
            <line
              x1="0"
              x2="100"
              y1={zeroYPercent}
              y2={zeroYPercent}
              stroke="#d4d8df"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Area wash */}
          <path
            d={splineFill}
            fill={`url(#${gradientId}-${metric === "income" ? "income-wash" : "lead-wash"})`}
          />

          {/* Sparkline stroke */}
          <path
            d={splineLine}
            fill="none"
            stroke={metric === "income" ? INCOME : "#23407a"}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Year Columns & Labels along the track */}
        <div className="absolute inset-0 flex">
          {years.map((year, index) => {
            const pt = curvePoints[index];

            return (
              <div
                key={year.periodEnd}
                className="relative flex h-full flex-1 flex-col items-center justify-end pb-1.5"
              >
                {/* Curve dot at year node */}
                {pt && (
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: "50%", top: `${pt.y}%` }}
                  >
                    <span className="block size-1.5 rounded-full bg-lead/70" />
                  </div>
                )}

                {/* Year Label */}
                <span className="font-mono text-[11px] tabular-nums text-faint">
                  {year.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
