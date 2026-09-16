"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { PeriodSelect, ViewToggle, type PeriodOption } from "./metric-controls";
import type { ChartView, MetricSeries, SeriesPoint } from "./metric-chart";

export type { MetricSeries, SeriesPoint, PeriodOption, ChartView };

/**
 * A proper time-series chart card: several named series against a real pair of
 * axes — counts up the left, dates along the bottom — inside the app's card.
 *
 * Why this exists next to `ProgressMetricCard`: that card is a KPI tile whose
 * chart is scenery. Its plot occupies the right 62% of the card so a headline
 * figure can sit over the left 38%, which is why its y-axis labels ended up on
 * the *right* and why the one big number over the top of three series never had
 * an honest caption — it was the sum of the first series only. A chart whose job
 * is "compare three lines over time" needs the opposite layout: the plot is the
 * content, it spans the card, and the numbers sit above it labelled one by one.
 *
 * What it keeps from the old card, because those parts worked: the morphing
 * curve animation when the window changes, the period dropdown with its custom
 * calendar, the line/bar toggle, and the hover crosshair.
 *
 * Colours are fixed per series *index*, never per visible position, so hiding a
 * series from the legend never repaints the ones that remain.
 */

/**
 * Categorical series colours, in fixed assignment order.
 *
 * The first three are validated for colour-blind separation and for 3:1 contrast
 * against both the light and dark card surfaces, so one palette serves both
 * themes. Past three, identity leans on the legend and the end-of-line labels.
 */
export const LINE_SERIES_COLORS = [
  "#5a9636", // 180DC green
  "#0284c7", // sky
  "#d97706", // amber
  "#7c3aed", // violet
  "#be123c", // rose
];

/** How many buckets before daily points stop being readable as three lines. */
const MAX_DAILY_BUCKETS = 35;
const MAX_WEEKLY_BUCKETS = 220;

type Grain = "day" | "week" | "month";

const GRAIN_NOTE: Record<Grain, string> = {
  day: "daily totals",
  week: "weekly totals",
  month: "four-week totals",
};

/** How many days each grain's bucket holds. */
const GRAIN_DAYS: Record<Grain, number> = { day: 1, week: 7, month: 28 };

/** A plotted point: a span of days and what happened across it. */
type Bucket = { start: string; end: string; value: number };

/** Top leaves room for the axis unit above the highest gridline. */
const PLOT_PAD = { top: 28, bottom: 30, left: 46 } as const;
/** Room at the right for the end-of-line labels; dropped on narrow cards. */
const END_LABEL_W = 78;
const END_LABEL_MIN_WIDTH = 520;
/** Minimum vertical gap between two end labels before they need pushing apart. */
const END_LABEL_LEAD = 13;
const BAR_MAX_W = 24;
/** Every curve is sampled to the same number of Bézier segments so it can morph. */
const SPLINE_SAMPLES = 40;

const MONTH_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function grainFor(buckets: number): Grain {
  if (buckets <= MAX_DAILY_BUCKETS) return "day";
  if (buckets <= MAX_WEEKLY_BUCKETS) return "week";
  return "month";
}

/**
 * Trim a series to the selected window. A preset keeps the trailing N points; an
 * explicit from/to (ISO days) filters inclusively and wins over the preset.
 */
function sliceWindow(points: SeriesPoint[], n?: number, from?: string, to?: string): SeriesPoint[] {
  let out = points;
  if (from) out = out.filter((point) => point.date >= from);
  if (to) out = out.filter((point) => point.date <= to);
  if (!from && !to && n && n < out.length) out = out.slice(-n);
  return out;
}

/**
 * Sum daily points into buckets, counted back from the most recent day.
 *
 * Anchoring at the end rather than on calendar weeks is what keeps the last
 * point honest: a calendar month or week that is only part-way through always
 * plots as a cliff, and a reader has no way to tell "we stopped emailing" from
 * "the month is only half over". Every bucket here covers the same number of
 * whole days, so the last one is comparable to the one before it. The cost is
 * the oldest few days, which fall off the left edge when the window does not
 * divide evenly — the end of the window is the part anyone is reading.
 *
 * Note what a weekly total is and is not: these are per-day distinct-client
 * counts, so a client contacted on Monday and again on Thursday counts twice in
 * that week's total. The bucket answers "how much contact happened that week",
 * not "how many different clients we touched that week" — which is why the card
 * prints the grain next to the title rather than leaving the reader to assume.
 */
function bucketSeries(points: SeriesPoint[], grain: Grain): Bucket[] {
  const size = GRAIN_DAYS[grain];
  if (size === 1) {
    return points.map((point) => ({ start: point.date, end: point.date, value: point.value }));
  }
  const buckets: Bucket[] = [];
  for (let end = points.length; end - size >= 0; end -= size) {
    const chunk = points.slice(end - size, end);
    buckets.unshift({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      value: chunk.reduce((sum, point) => sum + point.value, 0),
    });
  }
  return buckets;
}

/** Axis ticks on round numbers, from zero, never fractional for counts. */
function axisTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  // 1.5 and 3 are on the ladder so a max of 600 tops out at 600, not 800 —
  // a fifth of the plot left permanently empty reads as missing data.
  const rungs = [1, 1.5, 2, 2.5, 3, 5, 10];
  const step = Math.max(1, (rungs.find((rung) => normalised <= rung) ?? 10) * magnitude);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + 1e-9; value += step) ticks.push(Math.round(value));
  return ticks;
}

/**
 * A monotone Hermite (Fritsch–Carlson) spline through the points, resampled to a
 * fixed number of Bézier segments.
 *
 * Fixed topology is the whole point: every path this returns has the same
 * command structure, so Motion can morph one window's curve into the next
 * instead of cutting between them.
 */
function splinePath(points: { x: number; y: number }[], samples = SPLINE_SAMPLES): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) {
    const { x, y } = points[0];
    return `M ${x.toFixed(2)} ${y.toFixed(2)} L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  const dxs: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    dxs.push(dx);
    slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }

  const tangents: number[] = new Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const prev = slopes[i - 1];
    const next = slopes[i];
    if (prev * next <= 0) {
      tangents[i] = 0;
    } else {
      const hPrev = dxs[i - 1];
      const hNext = dxs[i];
      tangents[i] = (3 * (hPrev + hNext)) / ((2 * hNext + hPrev) / prev + (hNext + 2 * hPrev) / next);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = tangents[i] / slopes[i];
    const beta = tangents[i + 1] / slopes[i];
    const distance = alpha * alpha + beta * beta;
    if (distance > 9) {
      const tau = 3 / Math.sqrt(distance);
      tangents[i] = tau * alpha * slopes[i];
      tangents[i + 1] = tau * beta * slopes[i];
    }
  }

  const evaluate = (x: number): { y: number; dy: number } => {
    if (x <= points[0].x) return { y: points[0].y, dy: tangents[0] };
    if (x >= points[n - 1].x) return { y: points[n - 1].y, dy: tangents[n - 1] };
    let i = 0;
    while (i < n - 2 && points[i + 1].x < x) i++;
    const h = points[i + 1].x - points[i].x;
    if (h === 0) return { y: points[i].y, dy: 0 };
    const t = (x - points[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y0 = points[i].y;
    const y1 = points[i + 1].y;
    const m0 = tangents[i];
    const m1 = tangents[i + 1];
    return {
      y:
        (2 * t3 - 3 * t2 + 1) * y0 +
        (t3 - 2 * t2 + t) * h * m0 +
        (-2 * t3 + 3 * t2) * y1 +
        (t3 - t2) * h * m1,
      dy:
        ((6 * t2 - 6 * t) * y0 +
          (3 * t2 - 4 * t + 1) * h * m0 +
          (-6 * t2 + 6 * t) * y1 +
          (3 * t2 - 2 * t) * h * m1) /
        h,
    };
  };

  const minX = points[0].x;
  const maxX = points[n - 1].x;
  const step = (maxX - minX) / (samples - 1);
  const taken = Array.from({ length: samples }, (_, k) => {
    const x = minX + k * step;
    const { y, dy } = evaluate(x);
    return { x, y, dy };
  });

  let path = `M ${taken[0].x.toFixed(2)} ${taken[0].y.toFixed(2)}`;
  for (let k = 0; k < samples - 1; k++) {
    const a = taken[k];
    const b = taken[k + 1];
    const dx = b.x - a.x;
    path += ` C ${(a.x + dx / 3).toFixed(2)} ${(a.y + (a.dy * dx) / 3).toFixed(2)}, ${(
      b.x -
      dx / 3
    ).toFixed(2)} ${(b.y - (b.dy * dx) / 3).toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }
  return path;
}

/** A column with a rounded cap and square feet on the baseline. */
function columnPath(x: number, y: number, width: number, baseline: number): string {
  const height = Math.max(baseline - y, 0);
  const radius = Math.min(4, width / 2, height);
  if (height <= 0.5) return `M ${x} ${baseline} L ${x + width} ${baseline}`;
  return [
    `M ${x.toFixed(2)} ${baseline.toFixed(2)}`,
    `L ${x.toFixed(2)} ${(y + radius).toFixed(2)}`,
    `Q ${x.toFixed(2)} ${y.toFixed(2)} ${(x + radius).toFixed(2)} ${y.toFixed(2)}`,
    `L ${(x + width - radius).toFixed(2)} ${y.toFixed(2)}`,
    `Q ${(x + width).toFixed(2)} ${y.toFixed(2)} ${(x + width).toFixed(2)} ${(y + radius).toFixed(2)}`,
    `L ${(x + width).toFixed(2)} ${baseline.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatCompactCount(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}K`;
  return value.toLocaleString();
}

/** The x-axis tick under a bucket: the day it ends. */
function formatAxisDate(bucket: Bucket, withYear: boolean): string {
  return (withYear ? MONTH_DAY_YEAR : MONTH_DAY).format(parseDay(bucket.end));
}

/** The span a bucket covers, spelled out for the tooltip and the table. */
function formatBucketRange(bucket: Bucket): string {
  if (bucket.start === bucket.end) return MONTH_DAY_YEAR.format(parseDay(bucket.end));
  return `${MONTH_DAY.format(parseDay(bucket.start))} – ${MONTH_DAY_YEAR.format(parseDay(bucket.end))}`;
}

/**
 * Change against the window immediately before this one. `null` where there is
 * no window before it to compare against — a made-up "+100%" against nothing is
 * worse than saying nothing.
 */
function changeFor(
  total: number,
  previous: number | null,
): { text: string; direction: 1 | 0 | -1 } | null {
  if (previous === null) return null;
  if (previous === 0) {
    if (total === 0) return { text: "no change", direction: 0 };
    return { text: "all new", direction: 1 };
  }
  const pct = ((total - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return { text: "no change", direction: 0 };
  return {
    text: `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`,
    direction: pct > 0 ? 1 : -1,
  };
}

export interface SeriesLineChartCardProps {
  title: string;
  /** What one point means, in the words of the job. The grain is appended. */
  subtitle?: string;
  series: MetricSeries[];
  /** Plural noun for the y-axis caption and the tooltip, e.g. "clients". */
  unit?: string;
  period?: string;
  periodOptions?: PeriodOption[];
  allowCustomRange?: boolean;
  defaultView?: ChartView;
  /** Unique across the page: the view toggle's pill animates between matches. */
  toggleId?: string;
  emptyMessage?: string;
  className?: string;
}

export default function SeriesLineChartCard({
  title,
  subtitle,
  series,
  unit = "",
  period = "Past 30 days",
  periodOptions,
  allowCustomRange = false,
  defaultView = "curve",
  toggleId,
  emptyMessage = "Nothing to chart yet — this fills in as outreach happens.",
  className = "",
}: SeriesLineChartCardProps) {
  const reactId = useId().replace(/:/g, "");
  const periods = useMemo<PeriodOption[]>(
    () => periodOptions ?? [{ label: "Past 30 days", points: 30 }, { label: "Past 90 days", points: 90 }],
    [periodOptions],
  );
  const defaultPeriod = periods.find((option) => option.label === period) ?? periods[0];

  const [selected, setSelected] = useState<PeriodOption>(() => defaultPeriod);
  const [view, setView] = useState<ChartView>(defaultView);
  const [hiddenNames, setHiddenNames] = useState<string[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(node);
    setSize({ width: node.clientWidth, height: node.clientHeight });
  }, []);

  /** The full extent of the data, for the calendar's selectable bounds. */
  const bounds = useMemo(() => {
    let min: string | null = null;
    let max: string | null = null;
    for (const entry of series) {
      for (const point of entry.data) {
        if (min === null || point.date < min) min = point.date;
        if (max === null || point.date > max) max = point.date;
      }
    }
    return { min, max };
  }, [series]);

  const windowed = useMemo(
    () =>
      series.map((entry) => ({
        ...entry,
        data: sliceWindow(entry.data, selected.points, selected.from, selected.to),
      })),
    [series, selected],
  );

  /** The same length of time immediately before the window, for the change figures. */
  const previousWindow = useMemo(() => {
    const length = windowed[0]?.data.length ?? 0;
    if (length === 0) return series.map(() => [] as SeriesPoint[]);
    const firstDate = windowed[0].data[0].date;
    return series.map((entry) => {
      const before = entry.data.filter((point) => point.date < firstDate);
      return before.slice(-length);
    });
  }, [series, windowed]);

  const grain = grainFor(windowed[0]?.data.length ?? 0);

  const bucketed = useMemo(
    () => windowed.map((entry) => ({ ...entry, data: bucketSeries(entry.data, grain) })),
    [windowed, grain],
  );

  const totals = useMemo(
    () =>
      windowed.map((entry, index) => {
        const total = entry.data.reduce((sum, point) => sum + point.value, 0);
        const before = previousWindow[index];
        const previous = before.length === 0
          ? null
          : before.reduce((sum, point) => sum + point.value, 0);
        return { total, change: changeFor(total, previous) };
      }),
    [windowed, previousWindow],
  );

  const visible = bucketed.filter((entry) => !hiddenNames.includes(entry.name));
  const length = bucketed[0]?.data.length ?? 0;
  const hasData = length >= 2;

  const colourOf = useCallback(
    (name: string) => {
      const index = series.findIndex((entry) => entry.name === name);
      return LINE_SERIES_COLORS[(index < 0 ? 0 : index) % LINE_SERIES_COLORS.length];
    },
    [series],
  );

  const spansYears = useMemo(() => {
    const first = bucketed[0]?.data[0]?.end;
    const last = bucketed[0]?.data[length - 1]?.end;
    return Boolean(first && last && first.slice(0, 4) !== last.slice(0, 4));
  }, [bucketed, length]);

  const showEndLabels = size.width >= END_LABEL_MIN_WIDTH;
  const padRight = showEndLabels ? END_LABEL_W : 14;
  const plotLeft = PLOT_PAD.left;
  const plotTop = PLOT_PAD.top;
  const plotWidth = Math.max(size.width - plotLeft - padRight, 1);
  const plotBottom = Math.max(size.height - PLOT_PAD.bottom, plotTop + 1);
  const plotHeight = plotBottom - plotTop;

  const yMaxRaw = useMemo(() => {
    let max = 0;
    for (const entry of visible) for (const point of entry.data) max = Math.max(max, point.value);
    return max;
  }, [visible]);

  const ticks = useMemo(() => axisTicks(yMaxRaw), [yMaxRaw]);
  const yMax = ticks[ticks.length - 1] || 1;

  /**
   * Columns are centred in a slot rather than on the point, so the first group
   * cannot straddle the axis and paint over the y-axis labels; a line still
   * starts on the axis and ends on the right edge, as a line should.
   */
  const toX = useCallback(
    (index: number) => {
      if (length <= 1) return plotLeft + plotWidth / 2;
      if (view === "bars") return plotLeft + (plotWidth / length) * (index + 0.5);
      return plotLeft + (index / (length - 1)) * plotWidth;
    },
    [length, plotLeft, plotWidth, view],
  );
  const toY = useCallback(
    (value: number) => plotBottom - (value / yMax) * plotHeight,
    [plotBottom, plotHeight, yMax],
  );

  const xTicks = useMemo(() => {
    if (!hasData || plotWidth <= 0) return [];
    const room = grain === "day" ? 74 : 86;
    const count = Math.max(2, Math.min(6, Math.floor(plotWidth / room)));
    const indices = new Set<number>();
    for (let i = 0; i < count; i++) indices.add(Math.round((i * (length - 1)) / (count - 1)));
    return [...indices].sort((a, b) => a - b);
  }, [hasData, plotWidth, grain, length]);

  /**
   * End-of-line labels, pushed apart where two lines finish close together.
   * Nudging them is only honest while they stay attached to the right line, so
   * each one that moved gets a leader line back to its point.
   */
  const endLabels = useMemo(() => {
    if (!showEndLabels || !hasData) return [];
    const raw = visible
      .map((entry) => {
        const point = entry.data[entry.data.length - 1];
        if (!point) return null;
        return { name: entry.name, y: toY(point.value), anchor: toY(point.value) };
      })
      .filter((item): item is { name: string; y: number; anchor: number } => item !== null)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].y - raw[i - 1].y < END_LABEL_LEAD) raw[i].y = raw[i - 1].y + END_LABEL_LEAD;
    }
    const overflow = raw.length ? raw[raw.length - 1].y - plotBottom : 0;
    if (overflow > 0) for (const item of raw) item.y -= overflow;
    return raw;
  }, [showEndLabels, hasData, visible, toY, plotBottom]);

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (length <= 1) return setActive(0);
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - plotLeft) / plotWidth;
    const index = view === "bars" ? Math.floor(ratio * length) : Math.round(ratio * (length - 1));
    setActive(Math.min(length - 1, Math.max(0, index)));
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    setActive((current) => {
      const next = (current ?? (step > 0 ? -1 : length)) + step;
      return Math.min(length - 1, Math.max(0, next));
    });
  };

  const activeBucket = active === null ? null : (bucketed[0]?.data[active] ?? null);
  const grainNote = GRAIN_NOTE[grain];

  return (
    <div
      className={cn(
        "flex w-full flex-col rounded-[28px] border border-border bg-card p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {/* Header: what this is, then how much of it to show. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h3 className="text-[20px] font-semibold font-body tracking-tight text-foreground">
              {title}
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {subtitle ? `${subtitle} · ${grainNote}` : grainNote}
            </p>
          </div>
          <ViewToggle value={view} onChange={setView} layoutId={toggleId} />
        </div>
        <PeriodSelect
          value={selected.label}
          options={periods}
          onChange={setSelected}
          accentText="hsl(var(--foreground))"
          allowCustomRange={allowCustomRange}
          defaultOption={defaultPeriod}
          rangeMin={bounds.min}
          rangeMax={bounds.max}
        />
      </div>

      {/*
       * The legend is also the summary: one figure per series with its own
       * change against the period before. This is what replaced a single large
       * number over the plot — three lines deserve three captions, and a lone
       * figure could only ever have described one of them.
       */}
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        {bucketed.map((entry, index) => {
          const isHidden = hiddenNames.includes(entry.name);
          const colour = colourOf(entry.name);
          const summary = totals[index];
          return (
            <button
              key={entry.name}
              type="button"
              aria-pressed={!isHidden}
              onClick={() =>
                setHiddenNames((current) => {
                  if (!current.includes(entry.name)) {
                    // Never let the reader hide the last line and get an empty frame.
                    return current.length >= bucketed.length - 1 ? current : [...current, entry.name];
                  }
                  return current.filter((name) => name !== entry.name);
                })
              }
              className={cn(
                "group flex items-start gap-2 rounded-xl px-1.5 py-1 text-left transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                isHidden ? "opacity-40" : "opacity-100",
              )}
              title={isHidden ? `Show ${entry.name.toLowerCase()}` : `Hide ${entry.name.toLowerCase()}`}
            >
              <span
                aria-hidden
                className="mt-[7px] h-[3px] w-4 shrink-0 rounded-full"
                style={{ background: colour }}
              />
              <span className="flex flex-col">
                <span className="text-[12px] font-medium text-muted-foreground">{entry.name}</span>
                <span className="flex items-baseline gap-1.5">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={`${entry.name}-${summary.total}`}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.22 }}
                      className="text-[24px] font-semibold leading-tight tracking-tight text-foreground"
                    >
                      {formatCount(summary.total)}
                    </motion.span>
                  </AnimatePresence>
                  {summary.change && (
                    <span
                      className={cn(
                        "text-[11px] font-semibold",
                        summary.change.direction > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : summary.change.direction < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground",
                      )}
                      title="Against the same length of time just before this window"
                    >
                      {summary.change.text}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {!hasData ? (
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <p className="max-w-xs text-center text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <>
          <div
            ref={measure}
            role="img"
            tabIndex={0}
            aria-label={`${title}. ${bucketed
              .map((entry, index) => `${entry.name}: ${formatCount(totals[index].total)}`)
              .join(", ")} over ${selected.label.toLowerCase()}. Use the left and right arrow keys to read each point.`}
            className="relative mt-3 min-h-[220px] w-full flex-1 touch-none select-none rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={handleKey}
            onBlur={() => setActive(null)}
          >
            {size.width > 0 && (
              <svg width={size.width} height={size.height} className="absolute inset-0 overflow-visible">
                {/* Gridlines — solid hairlines, one step off the surface. */}
                {ticks.map((tick) => (
                  <line
                    key={`grid-${tick}`}
                    x1={plotLeft}
                    x2={plotLeft + plotWidth}
                    y1={toY(tick)}
                    y2={toY(tick)}
                    stroke="currentColor"
                    strokeWidth={1}
                    className={
                      tick === 0
                        ? "text-black/[0.14] dark:text-white/[0.18]"
                        : "text-black/[0.06] dark:text-white/[0.08]"
                    }
                  />
                ))}

                {/* The unit, kept attached to the axis it belongs to. */}
                {unit && (
                  <text
                    x={plotLeft - 10}
                    y={plotTop - 12}
                    textAnchor="end"
                    className="fill-foreground/35 text-[10px]"
                  >
                    {unit}
                  </text>
                )}

                {/* Y-axis labels, on the left where a reader looks for them. */}
                {ticks.map((tick) => (
                  <text
                    key={`ytick-${tick}`}
                    x={plotLeft - 10}
                    y={toY(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-foreground/45 text-[11px] tabular-nums"
                  >
                    {formatCompactCount(tick)}
                  </text>
                ))}

                {/* X-axis labels along the bottom. */}
                {xTicks.map((index, position) => (
                  <text
                    key={`xtick-${index}`}
                    x={toX(index)}
                    y={plotBottom + 18}
                    textAnchor={
                      position === 0 ? "start" : position === xTicks.length - 1 ? "end" : "middle"
                    }
                    className="fill-foreground/45 text-[11px]"
                  >
                    {formatAxisDate(bucketed[0].data[index], spansYears)}
                  </text>
                ))}

                {/* Crosshair: readers aim at a date, not at a 2px line. */}
                {active !== null && (
                  <motion.line
                    initial={false}
                    animate={{ x1: toX(active), x2: toX(active) }}
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    y1={plotTop - 4}
                    y2={plotBottom}
                    stroke="currentColor"
                    strokeWidth={1}
                    className="text-foreground/25"
                  />
                )}

                {view === "bars"
                  ? visible.map((entry, position) => {
                      const slot = plotWidth / Math.max(length, 1);
                      const width = Math.max(
                        Math.min((slot * 0.8) / visible.length - 2, BAR_MAX_W),
                        1,
                      );
                      const groupWidth = width * visible.length + 2 * (visible.length - 1);
                      const colour = colourOf(entry.name);
                      return (
                        <g key={entry.name}>
                          {entry.data.map((point, index) => {
                            const centre = toX(index);
                            const x =
                              centre - groupWidth / 2 + position * (width + 2);
                            return (
                              <motion.path
                                key={point.end}
                                d={columnPath(x, toY(point.value), width, plotBottom)}
                                initial={{ d: columnPath(x, plotBottom, width, plotBottom) }}
                                animate={{
                                  d: columnPath(x, toY(point.value), width, plotBottom),
                                  opacity: active === null || active === index ? 1 : 0.4,
                                }}
                                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                fill={colour}
                              />
                            );
                          })}
                        </g>
                      );
                    })
                  : visible.map((entry) => {
                      const colour = colourOf(entry.name);
                      const points = entry.data.map((point, index) => ({
                        x: toX(index),
                        y: toY(point.value),
                      }));
                      const path = splinePath(points);
                      return (
                        <motion.path
                          key={entry.name}
                          /*
                           * `d` is set as an attribute as well as animated. Motion
                           * morphs from whatever is already on the element, so a
                           * path that only ever had an `animate` value renders
                           * nothing at all until the first frame runs — which is
                           * every server render and every screenshot.
                           */
                          d={path}
                          initial={false}
                          animate={{ d: path }}
                          transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
                          fill="none"
                          stroke={colour}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })}

                {/* End-of-line labels: identity without color-matching. */}
                {view === "curve" &&
                  endLabels.map((label) => (
                    <g key={`end-${label.name}`}>
                      {Math.abs(label.y - label.anchor) > 1 && (
                        <line
                          x1={plotLeft + plotWidth}
                          y1={label.anchor}
                          x2={plotLeft + plotWidth + 8}
                          y2={label.y}
                          stroke={colourOf(label.name)}
                          strokeWidth={1}
                          opacity={0.5}
                        />
                      )}
                      <circle
                        cx={plotLeft + plotWidth}
                        cy={label.anchor}
                        r={3.5}
                        fill={colourOf(label.name)}
                        className="stroke-card"
                        strokeWidth={2}
                      />
                      <text
                        x={plotLeft + plotWidth + 11}
                        y={label.y}
                        dominantBaseline="middle"
                        className="fill-foreground/55 text-[11px] font-medium"
                      >
                        {label.name.replace(/^clients\s+/i, "")}
                      </text>
                    </g>
                  ))}

                {/* Markers on the read point, ringed in the surface colour. */}
                {view === "curve" &&
                  active !== null &&
                  visible.map((entry) => {
                    const point = entry.data[Math.min(active, entry.data.length - 1)];
                    if (!point) return null;
                    return (
                      <motion.circle
                        key={`dot-${entry.name}`}
                        initial={false}
                        animate={{ cx: toX(active), cy: toY(point.value) }}
                        transition={{ type: "spring", stiffness: 450, damping: 30 }}
                        r={4.5}
                        fill={colourOf(entry.name)}
                        className="stroke-card"
                        strokeWidth={2}
                      />
                    );
                  })}
              </svg>
            )}

            {/* Tooltip: every series at that date, values leading. */}
            <AnimatePresence>
              {active !== null && activeBucket && size.width > 0 && (
                <motion.div
                  className="pointer-events-none absolute z-50"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ left: toX(active), top: plotTop, opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{
                    left: { type: "spring", stiffness: 450, damping: 32 },
                    opacity: { duration: 0.15 },
                    scale: { duration: 0.15 },
                  }}
                  style={{
                    translate:
                      toX(active) > plotLeft + plotWidth / 2 ? "calc(-100% - 12px) 0" : "12px 0",
                  }}
                >
                  <div className="min-w-[150px] rounded-xl border border-black/[0.08] bg-popover/95 px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-md dark:border-white/[0.12]">
                    <p className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80">
                      {formatBucketRange(activeBucket)}
                    </p>
                    <div className="mt-1.5 space-y-1">
                      {bucketed.map((entry) => (
                        <div
                          key={entry.name}
                          className="flex items-center justify-between gap-4 whitespace-nowrap text-[13px]"
                        >
                          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                            <span
                              aria-hidden
                              className="h-[3px] w-3 rounded-full"
                              style={{ background: colourOf(entry.name) }}
                            />
                            {entry.name}
                          </span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatCount(entry.data[Math.min(active, entry.data.length - 1)]?.value ?? 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* The same numbers without the chart, for screen readers. */}
          <table className="sr-only" id={`${reactId}-table`}>
            <caption>{`${title} — ${grainNote} over ${selected.label.toLowerCase()}`}</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                {bucketed.map((entry) => (
                  <th key={entry.name} scope="col">
                    {entry.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bucketed[0].data.map((point, index) => (
                <tr key={point.end}>
                  <th scope="row">{formatBucketRange(point)}</th>
                  {bucketed.map((entry) => (
                    <td key={entry.name}>{formatCount(entry.data[index]?.value ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
