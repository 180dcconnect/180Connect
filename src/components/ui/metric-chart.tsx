"use client";

import { useId, useMemo, useState } from "react";
import { motion } from "motion/react";

/** One point on a metric line: a value and the label for its x position. */
export type SeriesPoint = { value: number; date: string };

/** A named series, optionally pinned to its own accent colour. */
export type MetricSeries = { name: string; data: SeriesPoint[]; accent?: MetricAccent };

export type MetricAccent = "emerald" | "rose" | "neutral" | "brand";

export type ChartView = "curve" | "bars";

/** What MetricChart actually draws: a series whose colour is already resolved. */
export type ChartSeries = { name: string; data: SeriesPoint[]; color: string };

/**
 * Accent palette. `brand` is 180DC green so a card can opt into the house
 * colour; the other three are the up/down/flat signals the card derives from
 * the data itself.
 */
export const ACCENTS: Record<MetricAccent, { stroke: string; text: string }> = {
  emerald: { stroke: "#10b981", text: "#059669" },
  rose: { stroke: "#f43f5e", text: "#e11d48" },
  neutral: { stroke: "#8a898b", text: "#8a898b" },
  brand: { stroke: "#72b744", text: "#5a9636" },
};

/** Cycled through when a card draws more than one series and none set an accent. */
export const SERIES_COLORS = ["#72b744", "#0ea5e9", "#f59e0b", "#a855f7", "#f43f5e"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Default x-axis label: an ISO day becomes "15 Aug, 2026", anything else is
 * already a label and passes through untouched.
 *
 * This lives here rather than in a `dateFormatter` prop supplied by the caller
 * because the cards are rendered from Server Components, and a function cannot
 * cross that boundary.
 */
export function formatPointDate(date: string): string {
  if (!ISO_DAY.test(date)) return date;
  const parts = DAY_LABEL.formatToParts(new Date(`${date}T00:00:00Z`));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("year")}`;
}

/** 1_240 → "1.2K". Used for the headline and the peak/low/avg footer. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${Math.round(value)}`;
}

/*
 * The chart draws into a 0-100 viewBox with preserveAspectRatio="none", so one
 * unit is a percentage of the region in each axis independently. Strokes are
 * marked non-scaling so that stretch never thickens a line.
 *
 * The band leaves headroom at the top for the card's headline and clearance at
 * the bottom for its opaque footer — the chart sits behind both.
 */
const BAND_TOP = 34;
const BAND_BOTTOM = 99.5;
const X_INSET = 3;

const toX = (i: number, len: number) =>
  len <= 1 ? 50 : X_INSET + (i / (len - 1)) * (100 - X_INSET * 2);

const NUM_SPLINE_SAMPLES = 32;

/**
 * Uniformly samples a monotone Hermite cubic spline (Fritsch-Carlson) into a fixed
 * topology of N Bézier segments.
 *
 * Because every generated SVG path has the exact same command structure (1 'M' + (N-1) 'C's),
 * Framer Motion `<motion.path>` smoothly morphs the curve when switching date ranges or
 * dataset sizes without glitches or command count mismatches.
 */
function sampleMonotoneSplinePath(
  pts: { x: number; y: number }[],
  bandBottom: number,
  numSamples = NUM_SPLINE_SAMPLES,
): { line: string; fill: string } {
  const n = pts.length;
  if (n < 1) {
    return { line: "", fill: "" };
  }
  if (n === 1) {
    const x0 = X_INSET;
    const x1 = 100 - X_INSET;
    const y0 = pts[0].y;
    const step = (x1 - x0) / (numSamples - 1);
    let line = `M ${x0.toFixed(3)} ${y0.toFixed(3)}`;
    for (let k = 0; k < numSamples - 1; k++) {
      const sx0 = x0 + k * step;
      const sx1 = sx0 + step;
      const dx = sx1 - sx0;
      line += ` C ${(sx0 + dx / 3).toFixed(3)} ${y0.toFixed(3)}, ${(sx1 - dx / 3).toFixed(3)} ${y0.toFixed(3)}, ${sx1.toFixed(3)} ${y0.toFixed(3)}`;
    }
    const fill = `${line} L ${x1.toFixed(3)} ${bandBottom.toFixed(3)} L ${x0.toFixed(3)} ${bandBottom.toFixed(3)} Z`;
    return { line, fill };
  }

  // 1. Calculate secants (slopes) & intervals
  const deltas: number[] = new Array(n - 1);
  const dxs: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dxs[i] = pts[i + 1].x - pts[i].x;
    deltas[i] = dxs[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dxs[i];
  }

  // 2. Calculate tangents at each point
  const m: number[] = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const dPrev = deltas[i - 1];
    const dNext = deltas[i];
    if (dPrev * dNext <= 0) {
      m[i] = 0;
    } else {
      const hPrev = dxs[i - 1];
      const hNext = dxs[i];
      m[i] = (3 * (hPrev + hNext)) / ((2 * hNext + hPrev) / dPrev + (hNext + 2 * hPrev) / dNext);
    }
  }

  m[0] = deltas[0];
  if (deltas.length > 1 && deltas[0] * deltas[1] <= 0) {
    m[0] = 0;
  }
  m[n - 1] = deltas[n - 2];
  if (deltas.length > 1 && deltas[n - 2] * deltas[n - 3] <= 0) {
    m[n - 1] = 0;
  }

  // 3. Fritsch-Carlson monotonicity condition
  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / deltas[i];
      const beta = m[i + 1] / deltas[i];
      const dist = alpha * alpha + beta * beta;
      if (dist > 9) {
        const tau = 3 / Math.sqrt(dist);
        m[i] = tau * alpha * deltas[i];
        m[i + 1] = tau * beta * deltas[i];
      }
    }
  }

  // Exact cubic spline evaluation at any x
  const evalSpline = (x: number): { y: number; dy: number } => {
    if (x <= pts[0].x) return { y: pts[0].y, dy: m[0] };
    if (x >= pts[n - 1].x) return { y: pts[n - 1].y, dy: m[n - 1] };

    let i = 0;
    while (i < n - 2 && pts[i + 1].x < x) {
      i++;
    }
    const x0 = pts[i].x;
    const x1 = pts[i + 1].x;
    const y0 = pts[i].y;
    const y1 = pts[i + 1].y;
    const m0 = m[i];
    const m1 = m[i + 1];
    const h = x1 - x0;
    if (h === 0) return { y: y0, dy: 0 };

    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;

    const y =
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * h * m0 +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * h * m1;

    const dy =
      ((6 * t2 - 6 * t) * y0 +
        (3 * t2 - 4 * t + 1) * h * m0 +
        (-6 * t2 + 6 * t) * y1 +
        (3 * t2 - 2 * t) * h * m1) /
      h;

    return { y, dy };
  };

  const minX = pts[0].x;
  const maxX = pts[n - 1].x;
  const step = (maxX - minX) / (numSamples - 1);

  const samples: { x: number; y: number; dy: number }[] = [];
  for (let k = 0; k < numSamples; k++) {
    const x = minX + k * step;
    const { y, dy } = evalSpline(x);
    samples.push({ x, y, dy });
  }

  let line = `M ${samples[0].x.toFixed(3)} ${samples[0].y.toFixed(3)}`;
  for (let k = 0; k < numSamples - 1; k++) {
    const s0 = samples[k];
    const s1 = samples[k + 1];
    const dx = s1.x - s0.x;
    const c1x = s0.x + dx / 3;
    const c1y = s0.y + (s0.dy * dx) / 3;
    const c2x = s1.x - dx / 3;
    const c2y = s1.y - (s1.dy * dx) / 3;
    line += ` C ${c1x.toFixed(3)} ${c1y.toFixed(3)}, ${c2x.toFixed(3)} ${c2y.toFixed(3)}, ${s1.x.toFixed(3)} ${s1.y.toFixed(3)}`;
  }

  const fill = `${line} L ${samples[numSamples - 1].x.toFixed(3)} ${bandBottom.toFixed(3)} L ${samples[0].x.toFixed(3)} ${bandBottom.toFixed(3)} Z`;
  return { line, fill };
}

export function MetricChart({
  series,
  view,
  defaultIndex,
  valueFormatter,
  dateFormatter,
  bandBottom = BAND_BOTTOM,
  bandTop = BAND_TOP,
}: {
  series: ChartSeries[];
  view: ChartView;
  /** Point the cursor rests on when nothing is hovered. */
  defaultIndex: number;
  valueFormatter: (value: number) => string;
  dateFormatter: (date: string) => string;
  bandBottom?: number;
  bandTop?: number;
}) {
  const rawId = useId().replace(/:/g, "");
  const [hovered, setHovered] = useState<number | null>(null);

  const length = series[0]?.data.length ?? 0;
  const active = Math.min(Math.max(hovered ?? defaultIndex, 0), Math.max(length - 1, 0));

  // One scale across every series, so two lines on the same card are comparable.
  const { min, max } = useMemo(() => {
    const values = series.flatMap((s) => s.data.map((d) => d.value));
    if (!values.length) return { min: 0, max: 1 };
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return hi === lo ? { min: lo - 1, max: hi + 1 } : { min: lo, max: hi };
  }, [series]);

  const toY = (value: number) =>
    bandBottom - ((value - min) / (max - min)) * (bandBottom - bandTop);

  if (!length) return null;

  const activeDate = series[0].data[active]?.date ?? "";
  const cursorX = toX(active, length);

  return (
    <div
      className="relative h-full w-full select-none touch-none"
      onPointerLeave={() => setHovered(null)}
      onPointerDown={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - box.left) / box.width;
        setHovered(Math.min(length - 1, Math.max(0, Math.round(ratio * (length - 1)))));
      }}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - box.left) / box.width;
        setHovered(Math.min(length - 1, Math.max(0, Math.round(ratio * (length - 1)))));
      }}
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`${rawId}-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="60%" stopColor={s.color} stopOpacity={0.08} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* Cursor guide line with spring tracking */}
        <motion.line
          initial={false}
          animate={{
            x1: cursorX,
            x2: cursorX,
            opacity: hovered !== null ? 0.45 : 0.22,
          }}
          transition={{
            x1: { type: "spring", stiffness: 450, damping: 32 },
            x2: { type: "spring", stiffness: 450, damping: 32 },
            opacity: { duration: 0.2 },
          }}
          y1={bandTop - 6}
          y2={bandBottom}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          className="text-foreground"
        />

        {series.map((s, seriesIndex) => {
          const pts = s.data.map((d, i) => ({ x: toX(i, s.data.length), y: toY(d.value) }));

          if (view === "bars") {
            const slot = (100 - X_INSET * 2) / Math.max(s.data.length, 1);
            const width = Math.max(slot * (series.length > 1 ? 0.34 : 0.5), 0.6);
            const offset = (seriesIndex - (series.length - 1) / 2) * width;
            return (
              <g key={s.name}>
                {pts.map((p, i) => {
                  const barX = p.x + offset - width / 2;
                  const barY = p.y;
                  const barHeight = Math.max(bandBottom - p.y, 0.5);
                  return (
                    <motion.rect
                      key={s.data[i].date}
                      x={barX}
                      width={width}
                      rx={0.5}
                      initial={false}
                      animate={{
                        y: barY,
                        height: barHeight,
                        opacity: i === active ? 1 : 0.42,
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 28,
                      }}
                      fill={s.color}
                    />
                  );
                })}
              </g>
            );
          }

          const { line, fill } = sampleMonotoneSplinePath(pts, bandBottom, NUM_SPLINE_SAMPLES);
          return (
            <g key={s.name}>
              {/* Smoothly morphing area fill */}
              <motion.path
                initial={false}
                animate={{ d: fill }}
                transition={{ duration: 0.65, ease: [0.2, 0.7, 0.2, 1] }}
                fill={`url(#${rawId}-fill-${seriesIndex})`}
              />
              {/* Smoothly morphing stroke */}
              <motion.path
                initial={false}
                animate={{ d: line }}
                transition={{ duration: 0.65, ease: [0.2, 0.7, 0.2, 1] }}
                fill="none"
                stroke={s.color}
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>

      {/* Point markers outside the SVG with spring physics tracking */}
      {view === "curve" &&
        series.map((s) => {
          const point = s.data[Math.min(active, s.data.length - 1)];
          if (!point) return null;
          const targetX = toX(Math.min(active, s.data.length - 1), s.data.length);
          const targetY = toY(point.value);
          return (
            <motion.div
              key={s.name}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
              initial={false}
              animate={{
                left: `${targetX}%`,
                top: `${targetY}%`,
                scale: hovered !== null ? 1.15 : 1,
              }}
              transition={{
                type: "spring",
                stiffness: 450,
                damping: 30,
              }}
            >
              {/* Glow ring */}
              <span
                className="absolute -inset-1 rounded-full opacity-35 blur-[2px]"
                style={{ background: s.color }}
              />
              {/* Dot */}
              <span
                className="relative block h-3 w-3 rounded-full border-2 border-white dark:border-black/60 shadow-sm"
                style={{ background: s.color }}
              />
            </motion.div>
          );
        })}

      {/* Tooltip: Glassmorphic card floating with smooth spring tracking */}
      <motion.div
        className="pointer-events-none absolute z-30"
        initial={false}
        animate={{
          left: `${cursorX}%`,
          top: `${BAND_TOP}%`,
        }}
        transition={{
          left: { type: "spring", stiffness: 450, damping: 32 },
          top: { type: "spring", stiffness: 450, damping: 32 },
        }}
        style={{
          transform: `translate(${active > length / 2 ? "-100%" : "0%"}, -50%)`,
        }}
      >
        <div className="relative min-w-[130px] rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-popover/95 px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.06)] backdrop-blur-md transition-shadow">
          <p className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80">
            {dateFormatter(activeDate)}
          </p>
          <div className="mt-1 space-y-1">
            {series.map((s) => {
              const val = s.data[Math.min(active, s.data.length - 1)]?.value ?? 0;
              return (
                <div
                  key={s.name}
                  className="flex items-center justify-between gap-3 whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full ring-2 ring-white dark:ring-black/40"
                      style={{
                        background: s.color,
                        boxShadow: `0 0 6px ${s.color}`,
                      }}
                    />
                    {series.length > 1 && (
                      <span className="text-[12px] font-medium text-muted-foreground">
                        {s.name}
                      </span>
                    )}
                  </div>
                  <span className="font-bold tracking-tight">
                    {valueFormatter(val)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
