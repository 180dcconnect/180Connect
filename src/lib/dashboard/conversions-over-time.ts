/**
 * F210 (#205) — Conversions Over Time.
 *
 * WHY THIS EXISTS ALONGSIDE THE CONVERSION RATE TREND, which looks like the
 * same chart and is not: `pipelineTrendSeries` (performance-metrics.ts) plots
 * cumulative converted/contacted — an *efficiency* reading, "of everyone we
 * approached, what share came good". This plots the *count* of conversions per
 * bucket — a volume reading, "how many did we actually win".
 *
 * They come apart in exactly the case a manager needs to catch: halve the
 * outreach and win half as many clients, and the rate chart doesn't move at all
 * while the thing the charity cares about drops 50%. The rate answers "is our
 * approach working"; the count answers "are we making progress". F210's AC asks
 * for the second one ("the number of conversions plotted across a time period"),
 * so both stay.
 *
 * The other difference is the window. The rate trend lives inside the
 * Performance section's trailing-90-day read; progress against a target is a
 * this-month / this-quarter / trailing-year question, so this reads its own
 * 12-month window and buckets by day, ISO week or calendar month to match.
 *
 * Team-wide by default, per AC3 — `filterUserId` exists for the CAM-scoped
 * case, not as the default view.
 */
import type { GrowthPoint } from "../dashboard-metrics.ts";

export type ConversionRow = {
  created_at: string;
  recorded_by_user_id: string | null;
  organisation_id: string;
};

export type Granularity = "day" | "week" | "month";

export type ConversionRange = {
  key: "month" | "quarter" | "year";
  label: string;
  granularity: Granularity;
  /** Inclusive ISO day (YYYY-MM-DD). */
  from: string;
  /** Inclusive ISO day (YYYY-MM-DD). */
  to: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Midnight UTC of the day `date` falls in, as epoch ms. */
function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Monday-start ISO week containing `ms`. */
function startOfWeek(ms: number): number {
  const date = new Date(ms);
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const offset = (date.getUTCDay() + 6) % 7;
  return ms - offset * DAY_MS;
}

function startOfMonth(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/** The next bucket start after `ms`, for stepping an axis that has gaps. */
function advance(ms: number, granularity: Granularity): number {
  if (granularity === "day") return ms + DAY_MS;
  if (granularity === "week") return ms + 7 * DAY_MS;
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function bucketStart(ms: number, granularity: Granularity): number {
  if (granularity === "day") return startOfDay(new Date(ms));
  if (granularity === "week") return startOfWeek(startOfDay(new Date(ms)));
  return startOfMonth(ms);
}

/**
 * The three ranges the card offers. "This month" and "this quarter" are the
 * calendar periods the AC names; the trailing 12 months is the third because a
 * quarter-to-date chart on 2 April has three data points and says nothing.
 */
export function conversionRanges(now: Date = new Date()): ConversionRange[] {
  const today = isoDay(startOfDay(now));
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const monthStart = isoDay(Date.UTC(year, month, 1));
  const quarterStart = isoDay(Date.UTC(year, Math.floor(month / 3) * 3, 1));
  // 11 whole months back plus the current one = 12 buckets inclusive.
  const yearStart = isoDay(Date.UTC(year, month - 11, 1));

  return [
    { key: "month", label: "This month", granularity: "day", from: monthStart, to: today },
    { key: "quarter", label: "This quarter", granularity: "week", from: quarterStart, to: today },
    { key: "year", label: "Last 12 months", granularity: "month", from: yearStart, to: today },
  ];
}

/**
 * Conversions per bucket across the range, including empty buckets — a month
 * with no wins has to appear as a zero, not vanish and make the line look
 * continuous.
 *
 * Counted as DISTINCT organisations per bucket: `outcomes` can hold more than
 * one converted row for a client (a re-recorded outcome, a correction), and two
 * rows for one charity is one conversion.
 */
export function conversionsOverTime(
  rows: readonly ConversionRow[],
  range: ConversionRange,
  filterUserId?: string,
): GrowthPoint[] {
  const fromMs = Date.parse(`${range.from}T00:00:00Z`);
  // Inclusive end: everything up to the last instant of `to`.
  const toMs = Date.parse(`${range.to}T00:00:00Z`) + DAY_MS - 1;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) return [];

  const orgsByBucket = new Map<string, Set<string>>();
  for (const row of rows) {
    if (filterUserId && row.recorded_by_user_id !== filterUserId) continue;
    const at = Date.parse(row.created_at);
    if (Number.isNaN(at) || at < fromMs || at > toMs) continue;
    const key = isoDay(bucketStart(at, range.granularity));
    let set = orgsByBucket.get(key);
    if (!set) {
      set = new Set();
      orgsByBucket.set(key, set);
    }
    set.add(row.organisation_id);
  }

  const points: GrowthPoint[] = [];
  let cursor = bucketStart(fromMs, range.granularity);
  // Guard the loop rather than trusting the arithmetic: a 12-month monthly
  // range is 12 points, a quarter of weeks is 14, a month of days is 31.
  for (let i = 0; cursor <= toMs && i < 400; i += 1) {
    const key = isoDay(cursor);
    points.push({ value: orgsByBucket.get(key)?.size ?? 0, date: key });
    cursor = advance(cursor, range.granularity);
  }
  return points;
}

/** Total conversions across the plotted buckets — the card's headline figure. */
export function conversionsTotal(points: readonly GrowthPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0);
}

/**
 * The change against the immediately preceding stretch of EQUAL LENGTH, so a
 * headline of "23" carries a "vs 17" beside it.
 *
 * Equal-length, not the same calendar period: on 15 September "this month"
 * (15 days) is compared against the 15 days before 1 September, not against the
 * whole of August. Comparing 15 days of work to 31 would show a collapse every
 * month and a recovery every month-end. This is the same prior-period rule the
 * Performance section's tiles use, so the two sections can't disagree.
 */
export function conversionsDelta(
  rows: readonly ConversionRow[],
  range: ConversionRange,
  filterUserId?: string,
): { current: number; previous: number } | null {
  const fromMs = Date.parse(`${range.from}T00:00:00Z`);
  const toMs = Date.parse(`${range.to}T00:00:00Z`) + DAY_MS - 1;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) return null;

  const span = toMs - fromMs + 1;
  const priorFrom = fromMs - span;
  const priorTo = fromMs - 1;

  const countDistinct = (start: number, end: number) => {
    const orgs = new Set<string>();
    for (const row of rows) {
      if (filterUserId && row.recorded_by_user_id !== filterUserId) continue;
      const at = Date.parse(row.created_at);
      if (Number.isNaN(at) || at < start || at > end) continue;
      orgs.add(row.organisation_id);
    }
    return orgs.size;
  };

  return { current: countDistinct(fromMs, toMs), previous: countDistinct(priorFrom, priorTo) };
}
