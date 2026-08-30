"use client";

import { FunnelChart, PatternLines } from "@/components/ui/funnel-chart";
import { type DashboardMetrics } from "@/lib/dashboard-metrics";

export function FunnelMetrics({ metrics }: { metrics: DashboardMetrics }) {
  const data = [
    {
      label: "Total pipeline",
      value: metrics.totalCharities,
      color: "var(--brand)",
    },
    {
      label: "Contacted",
      value: metrics.contacted,
      color: "var(--brand-muted)",
    },
    {
      label: "Responded",
      value: metrics.responsesReceived,
      color: "var(--brand-muted)",
    },
    {
      label: "Converted",
      value: metrics.converted,
      color: "var(--foreground)",
    },
  ];

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm flex flex-col space-y-6">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-lg">Conversion Funnel</h3>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
          Drop-off rates
        </p>
      </div>
      
      <div className="h-[240px] w-full">
        <FunnelChart
          data={data}
          orientation="horizontal"
          layers={3}
          hold={0.2}
          gap={2}
          showPercentage={true}
          showLabels={true}
          showValues={true}
          labelLayout="spread"
          renderPattern={(id, color) => (
            <PatternLines
              id={id}
              width={6}
              height={6}
              stroke={color}
              strokeWidth={1}
              orientation={["diagonal"]}
            />
          )}
        />
      </div>
      
      <div className="grid grid-cols-2 gap-4 border-t border-black/[0.06] pt-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Reply Rate</p>
          <p className="text-2xl font-semibold mt-1">{(metrics.replyRate * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">Conversion Rate</p>
          <p className="text-2xl font-semibold mt-1">{(metrics.conversionRate * 100).toFixed(1)}%</p>
        </div>
      </div>
    </div>
  );
}
