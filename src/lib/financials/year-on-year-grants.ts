import type {
  FinancialSeries,
  GrantInput,
} from "./financial-series.ts";

export interface GrantYearPoint {
  year: string;
  amount: number;
  awardCount: number;
  topFunder?: string;
}

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
