"use client";

import ProgressMetricCard from "@/components/ui/progress-metric-card";

const SAMPLE_30_DAYS = [
  { date: "2026-07-20", value: 1420 },
  { date: "2026-07-21", value: 1435 },
  { date: "2026-07-22", value: 1442 },
  { date: "2026-07-23", value: 1450 },
  { date: "2026-07-24", value: 1465 },
  { date: "2026-07-25", value: 1478 },
  { date: "2026-07-26", value: 1490 },
  { date: "2026-07-27", value: 1510 },
  { date: "2026-07-28", value: 1532 },
  { date: "2026-07-29", value: 1545 },
  { date: "2026-07-30", value: 1560 },
  { date: "2026-07-31", value: 1580 },
  { date: "2026-08-01", value: 1595 },
  { date: "2026-08-02", value: 1612 },
  { date: "2026-08-03", value: 1625 },
  { date: "2026-08-04", value: 1640 },
  { date: "2026-08-05", value: 1655 },
  { date: "2026-08-06", value: 1670 },
  { date: "2026-08-07", value: 1685 },
  { date: "2026-08-08", value: 1702 },
  { date: "2026-08-09", value: 1715 },
  { date: "2026-08-10", value: 1728 },
  { date: "2026-08-11", value: 1735 },
  { date: "2026-08-12", value: 1748 },
  { date: "2026-08-13", value: 1762 },
  { date: "2026-08-14", value: 1775 },
  { date: "2026-08-15", value: 1790 },
  { date: "2026-08-16", value: 1805 },
  { date: "2026-08-17", value: 1820 },
  { date: "2026-08-18", value: 1834 },
];

export default function PreviewMetricPage() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">
            Metric Chart Animation & Tooltip Preview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Test line morphing across 7d, 14d, 30d windows, bar mode, and hovering to inspect tooltips.
          </p>
        </div>

        {/* Large Dashboard Card */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Total Organisations (Large / Dashboard Style)
          </h2>
          <ProgressMetricCard
            size="lg"
            title="Total Organisations"
            accent="brand"
            data={SAMPLE_30_DAYS}
            period="Past 30 days"
            periodOptions={[
              { label: "Past 7 days", points: 7 },
              { label: "Past 14 days", points: 14 },
              { label: "Past 30 days" },
            ]}
            showFooter={true}
            className="rounded-2xl border-black/[0.06] shadow-sm bg-white"
          />
        </div>

        {/* Medium and Small Cards Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Medium Card (With Footer)
            </h2>
            <ProgressMetricCard
              size="md"
              title="Active Outreach"
              accent="emerald"
              data={SAMPLE_30_DAYS.map((d) => ({ ...d, value: Math.round(d.value * 0.4) }))}
              period="Past 30 days"
              periodOptions={[
                { label: "Past 7 days", points: 7 },
                { label: "Past 14 days", points: 14 },
                { label: "Past 30 days" },
              ]}
              showFooter={true}
              className="rounded-2xl border-black/[0.06] shadow-sm bg-white"
            />
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Small Card (Multi-Series)
            </h2>
            <ProgressMetricCard
              size="sm"
              title="Pipeline Comparison"
              series={[
                {
                  name: "Contacted",
                  data: SAMPLE_30_DAYS.map((d) => ({ ...d, value: Math.round(d.value * 0.5) })),
                  accent: "brand",
                },
                {
                  name: "Converted",
                  data: SAMPLE_30_DAYS.map((d) => ({ ...d, value: Math.round(d.value * 0.2) })),
                  accent: "emerald",
                },
              ]}
              period="Past 14 days"
              periodOptions={[
                { label: "Past 7 days", points: 7 },
                { label: "Past 14 days", points: 14 },
                { label: "Past 30 days" },
              ]}
              showFooter={false}
              className="rounded-2xl border-black/[0.06] shadow-sm bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
