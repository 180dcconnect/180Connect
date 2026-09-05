"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3 } from "lucide-react";
import { motion } from "motion/react";

import { formatCompactGbp, formatGbp } from "@/lib/income-band";
import type {
  FinancialSeries,
  GrantInput,
} from "@/lib/financials/financial-series";
import { calculateNiceYAxis, SURPLUS } from "./chart-parts";

export interface GrantYearPoint {
  year: string;
  amount: number;
  awardCount: number;
  topFunder?: string;
}

interface PeriodOption {
  label: string;
  count?: number;
}

type ChartView = "bars" | "curve";

/**
 * Builds a smooth monotone cubic Hermite spline path across data points.
 * Clamps y coordinates between 0 and 100 to ensure the fill and stroke stay within the plot canvas.
 */
export function buildMonotoneSplinePath(
  pts: { x: number; y: number }[],
): { line: string; fill: string } {
  const n = pts.length;
  if (n < 1) return { line: "", fill: "" };
  if (n === 1) {
    const y = Math.max(0, Math.min(100, pts[0].y));
    const line = `M 0 ${y.toFixed(2)} L 100 ${y.toFixed(2)}`;
    const fill = `${line} L 100 100 L 0 100 Z`;
    return { line, fill };
  }

  // 1. Calculate secants (slopes) & dx
  const dxs = new Float64Array(n - 1);
  const deltas = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dxs[i] = pts[i + 1].x - pts[i].x;
    deltas[i] = dxs[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dxs[i];
  }

  // 2. Tangents
  const m = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      m[i] = 0;
    } else {
      const hPrev = dxs[i - 1];
      const hNext = dxs[i];
      m[i] =
        (3 * (hPrev + hNext)) /
        ((2 * hNext + hPrev) / deltas[i - 1] + (hNext + 2 * hPrev) / deltas[i]);
    }
  }
  m[0] = deltas[0];
  if (deltas.length > 1 && deltas[0] * deltas[1] <= 0) m[0] = 0;
  m[n - 1] = deltas[n - 2];
  if (deltas.length > 1 && deltas[n - 2] * deltas[n - 3] <= 0) m[n - 1] = 0;

  // 3. Fritsch-Carlson monotonicity
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

  // 4. Cubic Bézier segments
  let line = `M ${pts[0].x.toFixed(2)} ${Math.max(0, Math.min(100, pts[0].y)).toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dx = p1.x - p0.x;
    const cp1x = p0.x + dx / 3;
    const cp1y = Math.max(0, Math.min(100, p0.y + (m[i] * dx) / 3));
    const cp2x = p1.x - dx / 3;
    const cp2y = Math.max(0, Math.min(100, p1.y - (m[i + 1] * dx) / 3));
    const targetY = Math.max(0, Math.min(100, p1.y));
    line += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p1.x.toFixed(2)} ${targetY.toFixed(2)}`;
  }

  const fill = `${line} L ${pts[n - 1].x.toFixed(2)} 100 L ${pts[0].x.toFixed(2)} 100 Z`;
  return { line, fill };
}

/**
 * Groups and structures grant data into year-by-year points for the chart.
 * Fills intermediate missing years when data spans <= 15 years to ensure the X-axis is an honest timeline.
 */
export function extractGrantYearPoints(
  series: FinancialSeries,
  grants?: readonly GrantInput[],
): GrantYearPoint[] {
  if (grants && grants.length > 0) {
    const byYear = new Map<
      string,
      {
        total: number;
        count: number;
        funders: Map<string, number>;
      }
    >();

    for (const g of grants) {
      if (!g.award_date || g.amount_awarded === null || g.amount_awarded <= 0) continue;
      const currency = (g.currency ?? "GBP").toUpperCase();
      if (currency !== "GBP") continue;
      const year = g.award_date.slice(0, 4);
      if (!/^\d{4}$/.test(year)) continue;

      const entry = byYear.get(year) ?? { total: 0, count: 0, funders: new Map() };
      entry.total += g.amount_awarded;
      entry.count += 1;
      if (g.funder_name && g.funder_name.trim()) {
        const fn = g.funder_name.trim();
        entry.funders.set(fn, (entry.funders.get(fn) ?? 0) + g.amount_awarded);
      }
      byYear.set(year, entry);
    }

    if (byYear.size >= 1) {
      const yearNums = [...byYear.keys()].map(Number).sort((a, b) => a - b);
      const min = yearNums[0];
      const max = yearNums[yearNums.length - 1];

      // Fill intermediate years if the time span is reasonable (<= 15 years)
      if (max - min >= 1 && max - min <= 15) {
        const rangePoints: GrantYearPoint[] = [];
        for (let y = min; y <= max; y++) {
          const yStr = String(y);
          const data = byYear.get(yStr);
          let topFunder: string | undefined;
          if (data && data.funders.size > 0) {
            topFunder = [...data.funders.entries()].sort((a, b) => b[1] - a[1])[0][0];
          }
          rangePoints.push({
            year: yStr,
            amount: data ? data.total : 0,
            awardCount: data ? data.count : 0,
            topFunder,
          });
        }
        return rangePoints;
      }

      if (byYear.size >= 2) {
        return [...byYear.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([year, data]) => {
            let topFunder: string | undefined;
            if (data.funders.size > 0) {
              topFunder = [...data.funders.entries()].sort((a, b) => b[1] - a[1])[0][0];
            }
            return {
              year,
              amount: data.total,
              awardCount: data.count,
              topFunder,
            };
          });
      }
    }
  }

  // Fall back to series.years if it has filed accounts with grants
  if (series.years.length >= 2 && series.hasGrants) {
    return series.years.map((y) => ({
      year: y.label,
      amount: y.grantTotal,
      awardCount: 0,
    }));
  }

  return [];
}

/**
 * Year-on-year grant funding won over time.
 * Built from the ground up for the Financials tab:
 * - Dedicated Y-axis graduation scale with formatted GBP figures.
 * - Horizontal gridlines aligned with each Y-axis step.
 * - Clear X-axis displaying consecutive years directly beneath data marks.
 * - Toggleable Bars and Curve views.
 * - Key summary metrics: total awarded, peak year, annual average, and latest delta.
 * - Real-time hover inspection bar and accessible tabular receipt disclosure.
 */
export function YearOnYearGrantsChart({
  series,
  grants,
}: {
  series: FinancialSeries;
  grants?: readonly GrantInput[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasEnteredView, setHasEnteredView] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [view, setView] = useState<ChartView>("bars");

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setHasEnteredView(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setHasEnteredView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(node);

    const timer = setTimeout(() => setHasEnteredView(true), 1000);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // 1. Group and structure data points by year
  const allPoints = useMemo<GrantYearPoint[]>(
    () => extractGrantYearPoints(series, grants),
    [series, grants],
  );

  // Period window selection
  const periodOptions: PeriodOption[] = useMemo(() => {
    const opts: PeriodOption[] = [];
    if (allPoints.length > 5) {
      opts.push({ label: "Past 5 years", count: 5 });
    }
    if (allPoints.length > 10) {
      opts.push({ label: "Past 10 years", count: 10 });
    }
    opts.push({ label: "All years" });
    return opts;
  }, [allPoints.length]);

  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string | null>(null);

  const activePeriod =
    periodOptions.find((p) => p.label === selectedPeriodLabel) ?? periodOptions[0];

  const windowPoints = useMemo(() => {
    if (activePeriod?.count && activePeriod.count < allPoints.length) {
      return allPoints.slice(-activePeriod.count);
    }
    return allPoints;
  }, [allPoints, activePeriod]);

  // Summary statistics across active window
  const totalAmount = useMemo(
    () => windowPoints.reduce((sum, p) => sum + p.amount, 0),
    [windowPoints],
  );

  const totalAwards = useMemo(
    () => windowPoints.reduce((sum, p) => sum + p.awardCount, 0),
    [windowPoints],
  );

  const peakPoint = useMemo(() => {
    return windowPoints.reduce(
      (max, p) => (p.amount > max.amount ? p : max),
      windowPoints[0] ?? { year: "", amount: 0, awardCount: 0 },
    );
  }, [windowPoints]);

  const avgAmount =
    windowPoints.length > 0 ? Math.round(totalAmount / windowPoints.length) : 0;

  const latestPoint = windowPoints[windowPoints.length - 1];
  const priorPoint =
    windowPoints.length >= 2 ? windowPoints[windowPoints.length - 2] : null;
  const delta = priorPoint ? latestPoint.amount - priorPoint.amount : null;
  const pctDelta =
    priorPoint && priorPoint.amount > 0
      ? Math.round(((latestPoint.amount - priorPoint.amount) / priorPoint.amount) * 100)
      : null;

  // Compute nice Y-axis graduation scale
  const yAxis = useMemo(
    () => calculateNiceYAxis(peakPoint.amount, 4),
    [peakPoint.amount],
  );
  const safeYMax = yAxis.max > 0 ? yAxis.max : 1;

  if (allPoints.length < 2) return null;

  const activePoint = hovered !== null ? windowPoints[hovered] : null;
  const activePrevPoint =
    hovered !== null && hovered > 0 ? windowPoints[hovered - 1] : null;
  const activePointDelta =
    activePoint && activePrevPoint ? activePoint.amount - activePrevPoint.amount : null;
  const isAnyHovered = hovered !== null;

  // Precompute spline coordinates for Curve view
  const curvePoints = windowPoints.map((pt, i) => ({
    x: ((i + 0.5) / windowPoints.length) * 100,
    y: (1 - pt.amount / safeYMax) * 100,
  }));
  const { line: splineLine, fill: splineFill } = buildMonotoneSplinePath(curvePoints);

  return (
    <div
      ref={containerRef}
      className="rounded-panel border border-rule bg-white p-5 sm:p-6 select-none"
    >
      {/* Header Row: Title, context, period filters, and view toggles */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-[15px] sm:text-[16px] font-semibold tracking-[-0.01em] text-ink">
              Year-on-year grant funding
            </h3>
            <span className="inline-flex items-center rounded-inset bg-paper px-2 py-0.5 font-mono text-[11px] font-medium text-dim">
              {windowPoints.length} {windowPoints.length === 1 ? "year" : "years"}
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-dim">
            Awarded grant funding won over time from 360Giving and public filings
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Period selector buttons */}
          {periodOptions.length > 1 && (
            <div className="inline-flex items-center rounded-inset bg-paper p-0.5 text-[12px]">
              {periodOptions.map((opt) => {
                const isSelected = activePeriod.label === opt.label;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSelectedPeriodLabel(opt.label)}
                    className={`rounded-inset px-2.5 py-1 font-medium transition-all ${
                      isSelected
                        ? "bg-white text-ink shadow-xs border border-rule-soft/80"
                        : "text-dim hover:text-ink"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* View Mode Toggle: Bars vs Curve */}
          <div className="inline-flex items-center rounded-inset bg-paper p-0.5">
            <button
              type="button"
              aria-label="Bar chart view"
              aria-pressed={view === "bars"}
              onClick={() => setView("bars")}
              className={`flex items-center gap-1.5 rounded-inset px-2.5 py-1 text-[12px] font-medium transition-all ${
                view === "bars"
                  ? "bg-white text-ink shadow-xs border border-rule-soft/80 font-semibold"
                  : "text-dim hover:text-ink"
              }`}
            >
              <BarChart3 className="size-3.5" />
              <span>Bars</span>
            </button>
            <button
              type="button"
              aria-label="Curve chart view"
              aria-pressed={view === "curve"}
              onClick={() => setView("curve")}
              className={`flex items-center gap-1.5 rounded-inset px-2.5 py-1 text-[12px] font-medium transition-all ${
                view === "curve"
                  ? "bg-white text-ink shadow-xs border border-rule-soft/80 font-semibold"
                  : "text-dim hover:text-ink"
              }`}
            >
              <Activity className="size-3.5" />
              <span>Curve</span>
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 border-y border-rule-soft py-3">
        <div>
          <p className="text-[11px] text-faint uppercase font-mono tracking-[0.06em]">
            Total awarded
          </p>
          <p className="mt-0.5 font-mono text-[18px] sm:text-[20px] font-bold tabular-nums text-ink">
            {formatCompactGbp(totalAmount)}
          </p>
          <p className="text-[11px] text-dim">
            {totalAwards > 0 ? `${totalAwards} awards recorded` : "across active window"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-faint uppercase font-mono tracking-[0.06em]">
            Peak year
          </p>
          <p className="mt-0.5 font-mono text-[18px] sm:text-[20px] font-bold tabular-nums text-ink">
            {formatCompactGbp(peakPoint.amount)}
          </p>
          <p className="text-[11px] text-dim">{peakPoint.year}</p>
        </div>
        <div>
          <p className="text-[11px] text-faint uppercase font-mono tracking-[0.06em]">
            Annual average
          </p>
          <p className="mt-0.5 font-mono text-[18px] sm:text-[20px] font-bold tabular-nums text-ink">
            {formatCompactGbp(avgAmount)}
          </p>
          <p className="text-[11px] text-dim">per recorded year</p>
        </div>
        <div>
          <p className="text-[11px] text-faint uppercase font-mono tracking-[0.06em]">
            Latest vs prior
          </p>
          <div className="mt-0.5 flex items-center gap-1 font-mono text-[18px] sm:text-[20px] font-bold tabular-nums">
            {delta !== null ? (
              <>
                <span className={delta >= 0 ? "text-go" : "text-stop"}>
                  {delta >= 0 ? "+" : "−"}{formatCompactGbp(Math.abs(delta))}
                </span>
                {pctDelta !== null && (
                  <span
                    className={`text-[12px] font-normal ${
                      delta >= 0 ? "text-go" : "text-stop"
                    }`}
                  >
                    ({delta >= 0 ? "+" : ""}{pctDelta}%)
                  </span>
                )}
              </>
            ) : (
              <span className="text-[14px] text-faint font-normal">No prior year</span>
            )}
          </div>
          <p className="text-[11px] text-dim">
            {latestPoint
              ? `${latestPoint.year} vs ${priorPoint?.year ?? "prior"}`
              : ""}
          </p>
        </div>
      </div>

      {/* Main Plot Area: Y-Axis Graduation on Left + Plot Canvas */}
      <div className="relative mt-5 pt-2">
        <div className="flex items-end">
          {/* Left Y-axis graduation scale with figures */}
          <div
            className="relative h-[260px] sm:h-[300px] w-14 shrink-0 sm:w-16"
            aria-hidden="true"
          >
            {yAxis.ticks.map((tick) => {
              const topPercent = (1 - tick / safeYMax) * 100;
              return (
                <div
                  key={tick}
                  className="absolute right-2.5 -translate-y-1/2 flex items-center justify-end"
                  style={{ top: `${topPercent}%` }}
                >
                  <span className="font-mono text-[10.5px] tabular-nums text-faint">
                    {formatCompactGbp(tick)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Right Plot Area: Gridlines + Data Elements */}
          <div
            className="relative h-[260px] sm:h-[300px] flex-1 min-w-0"
            onMouseLeave={() => setHovered(null)}
          >
            {/* Horizontal gridlines for each Y-axis graduation tick */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {yAxis.ticks.map((tick) => {
                const topPercent = (1 - tick / safeYMax) * 100;
                const isZero = tick === 0;
                return (
                  <div
                    key={`grid-${tick}`}
                    className={`absolute inset-x-0 h-px ${
                      isZero ? "bg-rule" : "bg-rule-soft/60"
                    }`}
                    style={{ top: `${topPercent}%` }}
                  />
                );
              })}
            </div>

            {/* VIEW 1: BARS */}
            {view === "bars" && (
              <div className="relative flex h-full items-end gap-1.5 sm:gap-2">
                {windowPoints.map((point, index) => {
                  const isHovered = hovered === index;
                  const hasAmount = point.amount > 0;
                  const heightPercent = hasAmount
                    ? Math.max(3, (point.amount / safeYMax) * 100)
                    : 0;

                  return (
                    <div
                      key={point.year}
                      onMouseEnter={() => setHovered(index)}
                      onMouseLeave={() => setHovered(null)}
                      className={`group relative flex h-full flex-1 cursor-pointer flex-col items-center justify-end rounded-t-panel px-0.5 pb-0 transition-colors duration-150 ${
                        isHovered ? "bg-paper/80" : ""
                      } ${isAnyHovered && !isHovered ? "opacity-45" : "opacity-100"}`}
                    >
                      {/* Floating pill badge above bar when hovered */}
                      {isHovered && hasAmount && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="absolute -top-7 z-20 whitespace-nowrap rounded-inset bg-ink px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white shadow-sm"
                        >
                          {formatCompactGbp(point.amount)}
                        </motion.div>
                      )}

                      {/* The Bar */}
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{
                          height: hasEnteredView ? `${heightPercent}%` : 0,
                          opacity: hasEnteredView ? (isHovered ? 1 : 0.88) : 0,
                        }}
                        transition={{
                          duration: 0.35,
                          delay: index * 0.04,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        className="w-full max-w-[32px] sm:max-w-[42px] rounded-t-[4px] transition-all duration-150"
                        style={{
                          backgroundColor: SURPLUS,
                          boxShadow: isHovered
                            ? "0 0 14px rgba(6, 118, 71, 0.3)"
                            : "none",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* VIEW 2: CURVE */}
            {view === "curve" && (
              <div className="relative h-full w-full">
                <svg
                  className="h-full w-full overflow-visible"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="grants-curve-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SURPLUS} stopOpacity={0.24} />
                      <stop offset="60%" stopColor={SURPLUS} stopOpacity={0.07} />
                      <stop offset="100%" stopColor={SURPLUS} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>

                  {/* Gradient area fill */}
                  <motion.path
                    initial={{ opacity: 0 }}
                    animate={{ opacity: hasEnteredView ? 1 : 0 }}
                    transition={{ duration: 0.5 }}
                    d={splineFill}
                    fill="url(#grants-curve-fill)"
                  />

                  {/* Smooth curve line */}
                  <motion.path
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{
                      pathLength: hasEnteredView ? 1 : 0,
                      opacity: hasEnteredView ? 1 : 0,
                    }}
                    transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
                    d={splineLine}
                    fill="none"
                    stroke={SURPLUS}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />

                  {/* Active cursor guideline */}
                  {hovered !== null && curvePoints[hovered] && (
                    <line
                      x1={curvePoints[hovered].x}
                      x2={curvePoints[hovered].x}
                      y1={0}
                      y2={100}
                      stroke={SURPLUS}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      vectorEffect="non-scaling-stroke"
                      className="opacity-60"
                    />
                  )}
                </svg>

                {/* Point markers and interactive hover slots */}
                <div className="absolute inset-0 flex">
                  {windowPoints.map((point, index) => {
                    const isHovered = hovered === index;
                    const pt = curvePoints[index];

                    return (
                      <div
                        key={point.year}
                        onMouseEnter={() => setHovered(index)}
                        onMouseLeave={() => setHovered(null)}
                        className="relative flex h-full flex-1 cursor-pointer items-center justify-center"
                      >
                        {/* Dot on the curve */}
                        <div
                          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-150"
                          style={{
                            left: "50%",
                            top: `${pt.y}%`,
                            transform: isHovered ? "scale(1.25)" : "scale(1)",
                          }}
                        >
                          <span
                            className="block size-2.5 rounded-full border-2 border-white shadow-xs"
                            style={{
                              backgroundColor: SURPLUS,
                              boxShadow: isHovered
                                ? "0 0 10px rgba(6, 118, 71, 0.4)"
                                : "none",
                            }}
                          />
                        </div>

                        {/* Floating pill badge above active point */}
                        {isHovered && point.amount > 0 && (
                          <div
                            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-inset bg-ink px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white shadow-sm"
                            style={{
                              left: "50%",
                              top: `${Math.max(12, pt.y - 4)}%`,
                            }}
                          >
                            {formatCompactGbp(point.amount)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* X-AXIS WITH YEARS: Placed directly beneath data marks */}
        <div className="mt-2 flex items-center">
          {/* Left gutter matching Y-axis */}
          <div className="w-14 shrink-0 sm:w-16" aria-hidden="true" />
          <div className="flex flex-1 min-w-0 gap-1.5 sm:gap-2">
            {windowPoints.map((point, index) => {
              const isHovered = hovered === index;
              return (
                <span
                  key={point.year}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  className={`flex-1 cursor-pointer text-center font-mono text-[11.5px] transition-colors ${
                    isHovered ? "font-semibold text-ink" : "text-dim"
                  } ${isAnyHovered && !isHovered ? "opacity-45" : "opacity-100"}`}
                >
                  {point.year}
                </span>
              );
            })}
          </div>
        </div>

        {/* TOOLTIP / INSPECTOR READOUT */}
        <div className="mt-3 flex items-start">
          <div className="w-14 shrink-0 sm:w-16" aria-hidden="true" />
          <div
            className="min-h-[22px] flex-1 min-w-0 text-[12.5px] text-dim"
            aria-live="polite"
          >
            {activePoint ? (
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold text-ink">{activePoint.year}</span>
                <span className="text-faint">·</span>
                <span className="font-mono font-semibold text-ink">
                  {formatGbp(activePoint.amount)}
                </span>
                <span>won</span>
                {activePoint.awardCount > 0 && (
                  <>
                    <span className="text-faint">·</span>
                    <span className="text-ink">
                      {activePoint.awardCount}{" "}
                      {activePoint.awardCount === 1 ? "award" : "awards"}
                    </span>
                  </>
                )}
                {activePoint.topFunder && (
                  <>
                    <span className="text-faint">·</span>
                    <span className="text-dim">
                      Largest:{" "}
                      <span className="text-ink font-medium">
                        {activePoint.topFunder}
                      </span>
                    </span>
                  </>
                )}
                {activePointDelta !== null && (
                  <>
                    <span className="text-faint">·</span>
                    <span
                      className={
                        activePointDelta >= 0
                          ? "text-go font-medium"
                          : "text-stop font-medium"
                      }
                    >
                      {activePointDelta >= 0 ? "+" : "−"}
                      {formatGbp(Math.abs(activePointDelta))} vs prior year
                    </span>
                  </>
                )}
              </div>
            ) : (
              <span>Hover a year for awarded grant totals and details.</span>
            )}
          </div>
        </div>

        {/* ACCESSIBLE TABULAR RECEIPT DISCLOSURE */}
        <details className="group mt-4 pt-2 border-t border-rule-soft">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead-mid [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="inline-block transition-transform group-open:rotate-90"
            >
              ›
            </span>
            View as a table
          </summary>
          <div className="mt-2.5 overflow-x-auto">
            <table className="w-full min-w-[24rem] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-rule-soft text-left text-faint">
                  <th scope="col" className="py-1.5 pr-4 font-medium">
                    Year
                  </th>
                  <th scope="col" className="py-1.5 pr-4 font-medium text-right">
                    Amount awarded
                  </th>
                  <th scope="col" className="py-1.5 pr-4 font-medium text-right">
                    Awards
                  </th>
                  <th scope="col" className="py-1.5 pr-4 font-medium text-right">
                    Share of total
                  </th>
                  <th scope="col" className="py-1.5 font-medium text-right">
                    Change vs prior
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule-soft/60">
                {windowPoints.map((pt, idx) => {
                  const prev = idx > 0 ? windowPoints[idx - 1] : null;
                  const diff = prev ? pt.amount - prev.amount : null;
                  const ptShare =
                    totalAmount > 0 ? (pt.amount / totalAmount) * 100 : 0;
                  return (
                    <tr
                      key={pt.year}
                      className="hover:bg-paper/50 transition-colors"
                    >
                      <td className="py-2 pr-4 font-medium text-ink font-mono">
                        {pt.year}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums text-ink">
                        {formatGbp(pt.amount)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums text-dim">
                        {pt.awardCount > 0 ? pt.awardCount : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums text-dim">
                        {pt.amount > 0 ? `${ptShare.toFixed(1)}%` : "0%"}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {diff === null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className={diff >= 0 ? "text-go" : "text-stop"}>
                            {diff >= 0 ? "+" : "−"}
                            {formatGbp(Math.abs(diff))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}
