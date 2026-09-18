import type { FinancialYear } from "./financial-series.ts";
import { buildMonotoneSplinePath } from "./year-on-year-grants.ts";

export type TrendMetric = "income" | "net";

export interface TimelineOverviewCalculation {
  curvePoints: { x: number; y: number }[];
  splineLine: string;
  splineFill: string;
  zeroYPercent: number | null;
}

/**
 * Computes SVG spline curve points and paths for the timeline overview scrubber.
 *
 * - "income" mode: scales from 0 to peak income, occupying the upper range.
 * - "net" mode: scales relative to the zero baseline at 48% height, rising for
 *   surplus and descending for deficit.
 */
export function calculateTimelineOverviewPoints(
  years: FinancialYear[],
  metric: TrendMetric,
): TimelineOverviewCalculation {
  const length = years.length;
  if (length < 2) {
    return { curvePoints: [], splineLine: "", splineFill: "", zeroYPercent: null };
  }

  if (metric === "income") {
    const incomes = years.map((y) => y.income ?? 0);
    const maxIncome = Math.max(...incomes, 1);
    const topY = 18;
    const bottomY = 78;
    const rangeY = bottomY - topY;

    const pts = years.map((y, i) => {
      const val = y.income ?? 0;
      const x = ((i + 0.5) / length) * 100;
      const yCoord = bottomY - (val / maxIncome) * rangeY;
      return { x, y: Math.max(topY, Math.min(bottomY, yCoord)) };
    });

    const { line, fill } = buildMonotoneSplinePath(pts);
    return { curvePoints: pts, splineLine: line, splineFill: fill, zeroYPercent: null };
  }

  // Net result mode (surplus/deficit)
  const nets = years.map((y) => y.net ?? 0);
  const absMax = Math.max(...nets.map(Math.abs), 1);
  const midY = 48;
  const maxOffset = 30;

  const pts = years.map((y, i) => {
    const netVal = y.net ?? 0;
    const x = ((i + 0.5) / length) * 100;
    const yCoord = midY - (netVal / absMax) * maxOffset;
    return { x, y: Math.max(16, Math.min(80, yCoord)) };
  });

  const { line, fill } = buildMonotoneSplinePath(pts);
  return { curvePoints: pts, splineLine: line, splineFill: fill, zeroYPercent: midY };
}
