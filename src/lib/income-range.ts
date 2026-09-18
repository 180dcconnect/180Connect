import { INCOME_BAND_OPTIONS, type IncomeBand } from "./income-band.ts";

/**
 * An annual income range — the shape the size slider edits, on the Charity
 * Commission import screen and on Outreach preferences.
 *
 * One module so both screens share the slider's scale, its labels and its
 * histogram, and so queue scoring and the settings screen agree on what "in
 * range" means. NULL bounds mean unbounded: `{ min: null, max: null }` is no
 * preference.
 */

export type IncomeRange = { min: number | null; max: number | null };

export const INCOME_RANGE_MIN = 0;
/** One step past £5m, so the top of the slider reads "£5m+" — no upper limit. */
export const INCOME_RANGE_MAX_PLUS = 5_250_000;
export const INCOME_RANGE_STEP = 25_000;

/** £0, £25k, £1.5m. */
export function formatIncome(value: number): string {
  if (value === 0) return "£0";
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return Number.isInteger(millions)
      ? `£${millions}m`
      : `£${millions.toFixed(2).replace(/\.?0+$/, "")}m`;
  }
  if (value >= 1_000) return `£${Math.round(value / 1_000)}k`;
  return `£${value}`;
}

export function formatIncomeSliderLabel(value: number): string {
  if (value >= INCOME_RANGE_MAX_PLUS) return "£5m+";
  return formatIncome(value);
}

/** Approximate income density distribution for UK registered charities from £0 to £5m+. */
export const CHARITY_INCOME_HISTOGRAM: readonly number[] = [
  1.0, 0.98, 0.95, 0.92, 0.89, 0.86, 0.83, 0.80, 0.77, 0.74,
  0.71, 0.68, 0.65, 0.63, 0.61, 0.59, 0.57, 0.55, 0.53, 0.51,
  0.49, 0.48, 0.47, 0.46, 0.45, 0.44, 0.43, 0.43, 0.42, 0.42,
  0.42, 0.41, 0.41, 0.41, 0.42, 0.42, 0.43, 0.44, 0.45, 0.46,
  0.47, 0.49, 0.51, 0.53, 0.56, 0.59, 0.63, 0.68, 0.74, 0.82,
];

/**
 * ── Relative stops ──
 *
 * A linear £0–£5m scale is the wrong shape for charity income: most charities
 * earn under £100k, and on a linear track that whole range is the first 2% —
 * one sliver you cannot aim at — while £1m–£5m, where a few hundred thousand
 * either way hardly matters, takes most of the width. So the size preference's
 * slider moves between these stops, each an equal step along the track: fine
 * where a difference changes the kind of organisation (£10k vs £25k), coarse
 * past £1m where it does not.
 *
 * Values are still stored in pounds (preferred_income_min / _max); the stops
 * only decide where the thumbs can rest. One position past the last stop is
 * "no upper limit".
 */
export const INCOME_STOPS: readonly number[] = [
  0, 5_000, 10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000, 250_000,
  350_000, 500_000, 600_000, 800_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000,
  5_000_000,
];

/** Slider positions: every stop, plus one for "no upper limit". */
export const INCOME_STOP_POSITIONS = INCOME_STOPS.length + 1;
const NO_LIMIT_POSITION = INCOME_STOPS.length;

function nearestStopIndex(value: number): number {
  let best = 0;
  for (let index = 1; index < INCOME_STOPS.length; index++) {
    if (Math.abs(INCOME_STOPS[index] - value) < Math.abs(INCOME_STOPS[best] - value)) {
      best = index;
    }
  }
  return best;
}

/** Slider position for a lower bound; null (from £0) is the first stop. */
export function positionForIncomeMin(min: number | null): number {
  return min === null ? 0 : nearestStopIndex(min);
}

/** Slider position for an upper bound; null (no limit) is past the last stop. */
export function positionForIncomeMax(max: number | null): number {
  return max === null ? NO_LIMIT_POSITION : Math.max(1, nearestStopIndex(max));
}

export function incomeMinAtPosition(position: number): number | null {
  return position <= 0 ? null : INCOME_STOPS[Math.min(position, INCOME_STOPS.length - 1)];
}

export function incomeMaxAtPosition(position: number): number | null {
  return position >= NO_LIMIT_POSITION ? null : INCOME_STOPS[Math.max(position, 0)];
}

export function incomeStopLabel(position: number): string {
  if (position >= NO_LIMIT_POSITION) return "No limit";
  return formatIncome(INCOME_STOPS[Math.max(position, 0)]);
}

/**
 * One bar per slider position, drawn as the same curve the Charity Commission
 * import slider uses — tall at the left, dipping through the middle, rising
 * again at the right — resampled to one point per stop. Decorative: it gives
 * the slider the same silhouette on both screens, it is not a count.
 */
export const INCOME_STOP_HISTOGRAM: readonly number[] = Array.from(
  { length: INCOME_STOP_POSITIONS },
  (_, position) =>
    CHARITY_INCOME_HISTOGRAM[
      Math.round((position * (CHARITY_INCOME_HISTOGRAM.length - 1)) / (INCOME_STOP_POSITIONS - 1))
    ],
);

export function isIncomeRangeActive(range: IncomeRange | null | undefined): boolean {
  return Boolean(range) && (range!.min !== null || range!.max !== null);
}

/** "£250k – £2m", "£100k+", "Up to £50k", or null for no preference. */
export function describeIncomeRange(range: IncomeRange | null | undefined): string | null {
  if (!range || !isIncomeRangeActive(range)) return null;
  if (range.min !== null && range.max !== null) {
    return `${formatIncome(range.min)} – ${formatIncome(range.max)}`;
  }
  if (range.min !== null) return `${formatIncome(range.min)}+`;
  return `Up to ${formatIncome(range.max!)}`;
}

/** Whether a filed income falls inside the range. No income never matches. */
export function incomeInRange(
  income: number | null | undefined,
  range: IncomeRange,
): boolean {
  if (income === null || income === undefined || Number.isNaN(income)) return false;
  if (range.min !== null && income < range.min) return false;
  if (range.max !== null && income > range.max) return false;
  return true;
}

/**
 * Edges of public.income_band, matching deriveIncomeBand's boundaries
 * (src/lib/income-band.ts).
 */
const BAND_EDGES: Record<IncomeBand, { lower: number; upper: number }> = {
  under_10k: { lower: 0, upper: 10_000 },
  "10k_100k": { lower: 10_000, upper: 100_000 },
  "100k_500k": { lower: 100_000, upper: 500_000 },
  "500k_1m": { lower: 500_000, upper: 1_000_000 },
  "1m_10m": { lower: 1_000_000, upper: 10_000_000 },
  "10m_50m": { lower: 10_000_000, upper: 50_000_000 },
  "50m_100m": { lower: 50_000_000, upper: 100_000_000 },
  over_100m: { lower: 100_000_000, upper: Number.POSITIVE_INFINITY },
};

/**
 * The bands a range overlaps — what is written to the legacy
 * `preferred_income_bands` column so band readers stay roughly right.
 */
export function bandsForIncomeRange(range: IncomeRange): IncomeBand[] {
  if (!isIncomeRangeActive(range)) return [];
  const low = range.min ?? 0;
  const high = range.max ?? Number.POSITIVE_INFINITY;
  return INCOME_BAND_OPTIONS.filter((band) => {
    const { lower, upper } = BAND_EDGES[band];
    return low < upper && high > lower;
  });
}

/** The range a set of bands covers — for rows saved before ranges existed. */
export function incomeRangeFromBands(bands: readonly IncomeBand[] | null | undefined): IncomeRange {
  const positions = (bands ?? [])
    .map((band) => INCOME_BAND_OPTIONS.indexOf(band))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b);
  if (positions.length === 0) return { min: null, max: null };
  const first = BAND_EDGES[INCOME_BAND_OPTIONS[positions[0]]];
  const last = BAND_EDGES[INCOME_BAND_OPTIONS[positions[positions.length - 1]]];
  return {
    min: first.lower === 0 ? null : first.lower,
    max: Number.isFinite(last.upper) ? last.upper : null,
  };
}

/**
 * A bound from untrusted input: a whole, non-negative number of pounds, or
 * null. The slider's top ("£5m+") and anything above it mean no upper limit.
 */
export function parseIncomeBound(value: unknown, side: "min" | "max"): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const rounded = Math.round(number);
  if (side === "min" && rounded === 0) return null;
  if (side === "max" && rounded >= INCOME_RANGE_MAX_PLUS) return null;
  return rounded;
}
