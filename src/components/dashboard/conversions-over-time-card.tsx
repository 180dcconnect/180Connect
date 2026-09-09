"use client";

import { useMemo, useState } from "react";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import type { PeriodOption } from "@/components/ui/metric-controls";
import {
  conversionRanges,
  conversionsDelta,
  conversionsOverTime,
  conversionsTotal,
  type ConversionRange,
  type ConversionRow,
} from "@/lib/dashboard/conversions-over-time";

/**
 * F210 (#205) — Conversions Over Time.
 *
 * Counts, in bars, against the conversion *rate* curve inside the Performance
 * section. The two are not redundant: the rate says how well the approach
 * converts what it touches, this says how many clients we actually won. Halve
 * the outreach and the rate holds while this halves — which is the case a
 * manager has to catch, and the reason both stay on the page.
 *
 * The range switch is the card's own period dropdown, wired to re-bucket rather
 * than to slice: switching to "Last 12 months" changes the bucket from a day to
 * a calendar month, which a trailing-N-points window cannot express. The
 * options therefore carry no `points`/`from`/`to`, so the card's internal
 * windowing is a no-op and this component owns the series.
 *
 * All of it is client-side over a 12-month window the server already sent, so
 * changing range never round-trips. Team-wide always (AC3): the per-CAM cut of
 * the same data is the Performance section's scope control.
 */
export function ConversionsOverTimeCard({
  conversions,
  className = "",
}: {
  conversions: ConversionRow[];
  className?: string;
}) {
  // Derived once from a single "now" so the three options can't straddle a
  // midnight and disagree about which day is last.
  const ranges = useMemo<ConversionRange[]>(() => conversionRanges(new Date()), []);
  const [rangeKey, setRangeKey] = useState<ConversionRange["key"]>("month");
  const range = ranges.find((entry) => entry.key === rangeKey) ?? ranges[0];

  const points = useMemo(
    () => conversionsOverTime(conversions, range),
    [conversions, range],
  );
  const total = conversionsTotal(points);
  const delta = useMemo(() => conversionsDelta(conversions, range), [conversions, range]);

  const periodOptions = useMemo<PeriodOption[]>(
    () => ranges.map((entry) => ({ label: entry.label })),
    [ranges],
  );

  const bucketLabel =
    range.granularity === "day" ? "per day" : range.granularity === "week" ? "per week" : "per month";

  // No prior data to compare against reads as "first in this window" rather than
  // a +100% off zero, which looks like a spike and means "we started".
  const deltaValue =
    delta === null || delta.previous === 0
      ? null
      : delta.current - delta.previous;

  const dateFormatter = (iso: string) => {
    const date = new Date(`${iso}T00:00:00Z`);
    if (range.granularity === "month") {
      return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
    }
    const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    return range.granularity === "week" ? `w/c ${day}` : day;
  };

  return (
    <ProgressMetricCard
      title="Conversions over time"
      total={total.toLocaleString()}
      unit={total === 1 ? "conversion" : "conversions"}
      delta={
        deltaValue === null
          ? "—"
          : `${deltaValue >= 0 ? "+" : "−"}${Math.abs(deltaValue).toLocaleString()}`
      }
      deltaLabel={
        delta === null || delta.previous === 0
          ? `${bucketLabel} · no prior period to compare`
          : `vs ${delta.previous.toLocaleString()} in the prior period · ${bucketLabel}`
      }
      trend={deltaValue === null ? "up" : deltaValue >= 0 ? "up" : "down"}
      period={range.label}
      periodOptions={periodOptions}
      onPeriodChange={(option) => {
        const next = ranges.find((entry) => entry.label === option.label);
        if (next) setRangeKey(next.key);
      }}
      defaultView="bars"
      accent="brand"
      data={points}
      dateFormatter={dateFormatter}
      valueFormatter={(value) => value.toLocaleString()}
      showStats
      size="md"
      className={`min-h-[300px] ${className}`}
    />
  );
}

export default ConversionsOverTimeCard;
