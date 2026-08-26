"use client";

import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import {
  ACCENTS,
  formatCompact,
  formatPointDate,
  MetricChart,
  SERIES_COLORS,
  type ChartSeries,
  type ChartView,
  type MetricAccent,
  type MetricSeries,
  type SeriesPoint,
} from "./metric-chart";
import { PeriodSelect, ViewToggle, type PeriodOption } from "./metric-controls";

// Re-exported so consumers import this file only.
export type { SeriesPoint, MetricSeries, MetricAccent, ChartView, PeriodOption };

export type CardSize = "sm" | "md" | "lg";

export interface ProgressMetricCardProps {
  title: string;
  total?: string | number;
  delta?: string;
  deltaLabel?: string;
  percent?: string;
  trend?: "up" | "down";
  unit?: string;
  period?: string;
  periodOptions?: PeriodOption[];
  onPeriodChange?: (option: PeriodOption) => void;
  defaultView?: ChartView;
  accent?: MetricAccent;
  /** Single series. Supply this OR `series`. */
  data?: SeriesPoint[];
  /** Several named series. Takes priority over `data`. */
  series?: MetricSeries[];
  defaultIndex?: number;
  size?: CardSize;
  /** Show the secondary stats (peak / low / avg) in the footer. */
  showStats?: boolean;
  /** Show the delta figure in the footer. */
  showDelta?: boolean;
  /** Show the bottom footer bar. If false, hides the line and all footer stats. */
  showFooter?: boolean;
  /** Offer a "Custom range" step in the period dropdown for exact dates. */
  allowCustomRange?: boolean;
  /** Value formatting. Default: compact in the headline, exact in the tooltip. */
  valueFormatter?: (value: number) => string;
  dateFormatter?: (date: string) => string;
  loading?: boolean;
  className?: string;
}

const DEFAULT_PERIODS: PeriodOption[] = [
  { label: "Past 7 days", points: 4 },
  { label: "Past 14 days", points: 7 },
  { label: "Past 30 days" },
];

// Share of the card (from the right) the chart region occupies.
const REGION_W = 62; // %
// A change under this threshold reads as "stable" → neutral accent.
const NEUTRAL_PCT = 0.5;

const SIZES: Record<
  CardSize,
  { minH: string; pad: string; footer: string; title: string; headline: string }
> = {
  sm: {
    minH: "min-h-[220px] sm:min-h-[260px]",
    pad: "px-5 pt-5 sm:px-6",
    footer: "px-5 py-3 sm:px-6",
    title: "text-[15px]",
    headline: "text-[38px] sm:text-[46px]",
  },
  md: {
    minH: "min-h-[300px] sm:min-h-[380px]",
    pad: "px-5 pt-6 sm:px-8 sm:pt-7",
    footer: "px-5 py-3 sm:px-8 sm:py-4",
    title: "text-[16px] sm:text-[17px]",
    headline: "text-[46px] sm:text-[72px]",
  },
  lg: {
    minH: "min-h-[320px] sm:min-h-[460px]",
    pad: "px-5 pt-6 sm:px-10 sm:pt-9",
    footer: "px-5 py-4 sm:px-10 sm:py-5",
    title: "text-[16px] sm:text-[19px]",
    headline: "text-[48px] sm:text-[88px]",
  },
};

/**
 * Trim a series down to the selected window. A preset (`points`) keeps the
 * trailing N points; an explicit `from`/`to` (ISO days) filters inclusively
 * by each point's date and wins over `points`.
 */
const sliceWindow = (points: SeriesPoint[], n?: number, from?: string, to?: string) => {
  let out = points;
  if (from) out = out.filter((p) => p.date >= from);
  if (to) out = out.filter((p) => p.date <= to);
  if (!from && !to && n && n < out.length) out = out.slice(-n);
  return out;
};

export default function ProgressMetricCard({
  title,
  total,
  delta,
  deltaLabel = "today",
  percent,
  trend,
  unit,
  period = "Past 30 days",
  periodOptions,
  onPeriodChange,
  defaultView = "curve",
  accent,
  data,
  series,
  defaultIndex,
  size = "md",
  showStats = true,
  showDelta = true,
  showFooter = true,
  allowCustomRange = false,
  valueFormatter,
  dateFormatter,
  loading = false,
  className = "",
}: ProgressMetricCardProps) {
  const hasFooter = showFooter && (showDelta || showStats);
  const gridId = `grid-${useId().replace(/:/g, "")}`;
  const sz = SIZES[size];
  const shell = `relative flex ${sz.minH} w-full flex-col overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_2px_10px_rgba(0,0,0,0.04)] ${className}`;

  const periods = periodOptions ?? DEFAULT_PERIODS;
  // The whole selected option is kept (not just its label) because an applied
  // custom range is not one of the preset `periods` and carries from/to dates.
  const defaultPeriod =
    periods.find((p) => p.label === period) ?? periods[periods.length - 1];
  const [selected, setSelected] = useState<PeriodOption>(() => defaultPeriod);
  const [view, setView] = useState<ChartView>(defaultView);

  // Normalise the input to a list of series (a plain `data` prop → one series).
  const baseSeries: MetricSeries[] = useMemo(
    () => (series?.length ? series : [{ name: title, data: data ?? [], accent }]),
    [series, data, title, accent],
  );

  // Cut every series down to the selected period.
  const visibleSeries = useMemo(
    () =>
      baseSeries.map((s) => ({
        ...s,
        data: sliceWindow(s.data, selected.points, selected.from, selected.to),
      })),
    [baseSeries, selected],
  );

  const primary = visibleSeries[0];
  const isMulti = visibleSeries.length > 1;
  const hasData = (primary?.data.length ?? 0) >= 2;

  // Every figure derives from the primary series, so the card stays coherent and
  // reacts to a period change. Explicit props still win.
  const stats = useMemo(() => {
    const vals = primary?.data.map((d) => d.value) ?? [];
    const sum = vals.reduce((a, b) => a + b, 0);
    const first = vals[0] ?? 0;
    const last = vals[vals.length - 1] ?? 0;
    const prev = vals[vals.length - 2] ?? first;
    const net = last - first;
    return {
      sum,
      net,
      first,
      pct: first ? (net / first) * 100 : 0,
      step: last - prev,
      peak: vals.length ? Math.max(...vals) : 0,
      low: vals.length ? Math.min(...vals) : 0,
      avg: vals.length ? sum / vals.length : 0,
    };
  }, [primary]);

  // A window that starts at zero has no percentage to quote — every growth is
  // infinite from nothing — so the change is stated as a count instead.
  const fromZero = stats.first === 0 && stats.net !== 0;

  // Colour follows direction (last vs first point), with a neutral dead zone.
  const resolvedTrend: "up" | "down" | "flat" =
    trend ??
    (fromZero
      ? stats.net >= 0
        ? "up"
        : "down"
      : Math.abs(stats.pct) < NEUTRAL_PCT
        ? "flat"
        : stats.net >= 0
          ? "up"
          : "down");
  const resolvedAccent: MetricAccent =
    accent ?? (resolvedTrend === "up" ? "emerald" : resolvedTrend === "down" ? "rose" : "neutral");
  const color = ACCENTS[resolvedAccent];
  const TrendIcon =
    resolvedTrend === "flat" ? ArrowRight : resolvedTrend === "down" ? ArrowDown : ArrowUp;

  const fmtCompact = valueFormatter ?? formatCompact;
  const fmtFull = valueFormatter ?? ((n: number) => n.toLocaleString() + (unit ? ` ${unit}` : ""));
  const fmtDate = dateFormatter ?? formatPointDate;
  const sign = (n: number) => (n >= 0 ? "+" : "−") + fmtCompact(Math.abs(n));

  const displayTotal = total ?? fmtCompact(stats.sum);
  const displayDelta = delta ?? sign(stats.step);
  const displayPercent =
    percent ?? (fromZero ? sign(stats.net) : `${Math.abs(stats.pct).toFixed(1)}%`);

  // Each series' colour: explicit accent → palette → the headline colour.
  const chartSeries: ChartSeries[] = visibleSeries.map((s, i) => ({
    name: s.name,
    data: s.data,
    color: s.accent
      ? ACCENTS[s.accent].stroke
      : isMulti
        ? SERIES_COLORS[i % SERIES_COLORS.length]
        : color.stroke,
  }));

  const lastIndex = (primary?.data.length ?? 1) - 1;
  const fallback = Math.min(defaultIndex ?? lastIndex, lastIndex);

  const handlePeriodChange = (option: PeriodOption) => {
    setSelected(option);
    onPeriodChange?.(option);
  };

  if (loading) {
    return (
      <div className={shell} aria-busy="true">
        <div className={`flex flex-1 flex-col ${sz.pad}`}>
          <div className="flex items-center justify-between">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-5 w-24 animate-pulse rounded bg-muted" />
          </div>
          <div className="mt-6 h-14 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="mt-auto h-24 w-full animate-pulse rounded-lg bg-muted/50" />
        </div>
        <div className={`border-t border-foreground/[0.06] ${sz.footer}`}>
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className={shell}>
        <div className={`flex flex-1 flex-col ${sz.pad}`}>
          <h3 className={`${sz.title} font-semibold tracking-tight text-foreground`}>{title}</h3>
          <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No data yet</p>
            <p className="text-xs text-muted-foreground">
              Metrics will appear once data is available.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      {/* Chart region (right-hand side, behind the content) */}
      <div className="absolute inset-y-0 right-0 z-0" style={{ width: `${REGION_W}%` }}>
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(to left, ${color.stroke}1f, transparent 75%)` }}
        />
        <div
          className="absolute inset-0 text-foreground/[0.13]"
          style={{
            WebkitMaskImage: "linear-gradient(to right, transparent, black 55%)",
            maskImage: "linear-gradient(to right, transparent, black 55%)",
          }}
        >
          <svg className="h-full w-full" aria-hidden>
            <defs>
              <pattern id={gridId} width="14" height="14" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="currentColor" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${gridId})`} />
          </svg>
        </div>

        <MetricChart
          series={chartSeries}
          view={view}
          defaultIndex={fallback}
          valueFormatter={fmtFull}
          dateFormatter={fmtDate}
        />
      </div>

      {/* Main content */}
      <div
        className={`pointer-events-none relative z-10 flex flex-1 flex-col ${sz.pad} ${
          !hasFooter ? (size === "lg" ? "pb-9" : size === "md" ? "pb-7" : "pb-5") : ""
        }`}
      >
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className={`${sz.title} font-semibold tracking-tight text-foreground`}>{title}</h3>
            <ViewToggle value={view} onChange={setView} />
          </div>
          <div className="flex items-center gap-3.5 text-[14px]">
            <motion.span
              key={`trend-${selected.label}`}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-1 font-medium"
              style={{ color: color.text }}
            >
              <TrendIcon size={16} strokeWidth={2.5} />
              {displayPercent}
            </motion.span>
          <PeriodSelect
            value={selected.label}
            options={periods}
            onChange={handlePeriodChange}
            accentText={color.text}
            allowCustomRange={allowCustomRange}
            defaultOption={defaultPeriod}
          />
          </div>
        </div>

        {/* Legend (multi-series only) */}
        {isMulti && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            {chartSeries.map((s) => (
              <span
                key={s.name}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        )}

        {/* Headline metric */}
        <motion.div
          key={`headline-${selected.label}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
          className={`mt-5 ${sz.headline} font-medium leading-none tracking-tight text-foreground`}
        >
          {displayTotal}
        </motion.div>
      </div>

      {/* Opaque footer: delta on the left, secondary stats on the right */}
      {hasFooter && (
        <div
          className={`relative z-10 flex items-center justify-between gap-4 border-t border-foreground/[0.06] bg-card ${sz.footer} text-[14px]`}
        >
          {showDelta && (
            <div>
              <motion.span
                key={`delta-${selected.label}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="font-medium"
                style={{ color: color.text }}
              >
                {displayDelta}
              </motion.span>{" "}
              <span className="text-muted-foreground">{deltaLabel}</span>
            </div>
          )}
          {showStats && (
            <div className="ml-auto flex items-center gap-2.5 text-[12px] text-muted-foreground">
              <span>
                <span className="font-medium text-foreground/80">{fmtCompact(stats.peak)}</span> peak
              </span>
              <span className="opacity-40">·</span>
              <span>
                <span className="font-medium text-foreground/80">{fmtCompact(stats.low)}</span> low
              </span>
              <span className="opacity-40">·</span>
              <span>
                <span className="font-medium text-foreground/80">
                  {fmtCompact(Math.round(stats.avg))}
                </span>{" "}
                avg
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
