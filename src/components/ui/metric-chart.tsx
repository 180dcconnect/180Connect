"use client";

import { useId, useMemo, useState } from "react";

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

/**
 * Monotone cubic spline (Fritsch-Carlson) through the points, converted to cubic Béziers.
 * Guarantees that flat regions stay completely flat and slopes do not overshoot between data points.
 */
function curvePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }

  // 1. Calculate secants (slopes)
  const deltas: number[] = new Array(n - 1);
  const dxs: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dxs[i] = pts[i + 1].x - pts[i].x;
    deltas[i] = dxs[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dxs[i];
  }

  // 2. Calculate tangents at each point
  const m: number[] = new Array(n);

  // Interior tangents
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

  // Endpoints tangents
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

  // 4. Build cubic bezier SVG path
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = dxs[i];
    const c1x = pts[i].x + dx / 3;
    const c1y = pts[i].y + (m[i] * dx) / 3;
    const c2x = pts[i + 1].x - dx / 3;
    const c2y = pts[i + 1].y - (m[i + 1] * dx) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
  }

  return d;
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

  return (
    <div
      className="relative h-full w-full"
      onPointerLeave={() => setHovered(null)}
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
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* Cursor guide, behind the marks. */}
        <line
          x1={toX(active, length)}
          x2={toX(active, length)}
          y1={bandTop - 6}
          y2={bandBottom}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          className="text-foreground/25"
        />

        {series.map((s, seriesIndex) => {
          const pts = s.data.map((d, i) => ({ x: toX(i, s.data.length), y: toY(d.value) }));

          if (view === "bars") {
            // Width from the gap between points, so a 4-point window doesn't
            // draw hairlines and a 30-point one doesn't overlap.
            const slot = (100 - X_INSET * 2) / Math.max(s.data.length, 1);
            const width = Math.max(slot * (series.length > 1 ? 0.34 : 0.5), 0.6);
            const offset = (seriesIndex - (series.length - 1) / 2) * width;
            return (
              <g key={s.name}>
                {pts.map((p, i) => (
                  <rect
                    key={s.data[i].date}
                    x={p.x + offset - width / 2}
                    y={p.y}
                    width={width}
                    height={Math.max(bandBottom - p.y, 0.5)}
                    fill={s.color}
                    opacity={i === active ? 1 : 0.45}
                  />
                ))}
              </g>
            );
          }

          const line = curvePath(pts);
          return (
            <g key={s.name}>
              <path
                d={`${line} L ${pts[pts.length - 1].x} ${bandBottom} L ${pts[0].x} ${bandBottom} Z`}
                fill={`url(#${rawId}-fill-${seriesIndex})`}
              />
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>

      {/* Point markers sit outside the SVG: circles in a stretched viewBox draw
          as ellipses, so they are positioned in percentages instead. */}
      {view === "curve" &&
        series.map((s) => {
          const point = s.data[Math.min(active, s.data.length - 1)];
          if (!point) return null;
          return (
            <span
              key={s.name}
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
              style={{
                left: `${toX(Math.min(active, s.data.length - 1), s.data.length)}%`,
                top: `${toY(point.value)}%`,
                background: s.color,
              }}
            />
          );
        })}

      {/* Tooltip. It hangs *below* the top of the band rather than above the
          hovered point: that keeps it clear of the card's header row and of its
          clipped rounded top at every card size, and the space above a line is
          the emptiest part of the region. Horizontally it flips side at the
          halfway mark so it never runs off the right edge. */}
      <div
        className="pointer-events-none absolute z-20"
        style={{
          left: `${toX(active, length)}%`,
          top: `${BAND_TOP}%`,
          transform: `translate(${active > length / 2 ? "-100%" : "0"}, -50%)`,
        }}
      >
        <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
          <p className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/40">
            {dateFormatter(activeDate)}
          </p>
          {series.map((s) => (
            <p
              key={s.name}
              className="mt-1 flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold tabular-nums"
            >
              {series.length > 1 && (
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              )}
              {valueFormatter(s.data[Math.min(active, s.data.length - 1)]?.value ?? 0)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
