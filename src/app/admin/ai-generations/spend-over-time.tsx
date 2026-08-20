"use client";

import { ACCENTS, MetricChart, formatCompact, formatPointDate } from "@/components/ui/metric-chart";
import type { GenerationDayPoint, GenerationMetric } from "@/lib/outreach/generation-history";

// Unlike pipeline-report.tsx's plain render of <FunnelChart data={...} />, this
// component calls formatCompact/formatPointDate itself (formatValue, below) —
// both are exported from metric-chart.tsx, a "use client" module, so calling
// them (not just passing data to a client child) requires this file to be a
// client component too. Confirmed live: without this directive, Next throws
// "Attempted to call formatCompact() from the server but formatCompact is on
// the client" the moment this page renders.

const METRIC_LABEL: Record<GenerationMetric, string> = {
  count: "Generations",
  tokens: "Tokens used",
  cost: "Spend",
};

function formatValue(metric: GenerationMetric, value: number): string {
  if (metric === "cost") return `$${value < 1 ? value.toFixed(4) : value.toFixed(2)}`;
  return formatCompact(value);
}

/**
 * F213 AC2 — "aggregate AI spend over a time period, not just a running total
 * with no historical breakdown." The day-by-day shape is the point: a single
 * lifetime total can't show a spike or a quiet week, this can.
 */
export function SpendOverTime({
  points,
  metric,
}: {
  points: GenerationDayPoint[];
  metric: GenerationMetric;
}) {
  if (points.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-brand/15 bg-gradient-to-br from-white to-brand/[0.06] px-6 py-14 text-center shadow-sm">
        <p className="text-sm text-foreground/50">
          No generations recorded yet — this fills in day by day as CAMs generate drafts.
        </p>
      </div>
    );
  }

  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-brand/15 bg-gradient-to-br from-white to-brand/[0.06] p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{METRIC_LABEL[metric]} over time</h2>
        <p className="text-sm font-bold tabular-nums text-brand-hover">
          {formatValue(metric, total)} <span className="font-medium text-foreground/40">total</span>
        </p>
      </div>
      <div className="mt-6 h-[220px]">
        <MetricChart
          dateFormatter={formatPointDate}
          defaultIndex={points.length - 1}
          series={[{ name: METRIC_LABEL[metric], data: points, color: ACCENTS.brand.stroke }]}
          valueFormatter={(value) => formatValue(metric, value)}
          view="curve"
        />
      </div>
    </div>
  );
}
