// F113 — Track Model Used (#110) / F213 — LLM Cost Tracking (#208): the pure,
// DB-free half of the admin generation history view — same pure/DI split as
// discrepancies/detect-field-discrepancies.ts. F113 AC3 and F213 AC2 both want
// "group/filter by model" and "aggregate spend over a period" — groupByModel is
// the model breakdown, groupByDay is the time-based aggregate; the page itself
// does the "filter" half via a plain `?model=` query param against the same rows.

export type GenerationMetric = "count" | "tokens" | "cost";

export type GenerationRecord = {
  model: string;
  createdAt: string;
  totalTokens: number | null;
  costUsd: number | null;
};

export type GenerationModelBreakdown = {
  model: string;
  count: number;
  share: number;
  totalTokens: number;
  /** True when at least one row in this model's group had no token count — the sum is a floor, not the full picture. */
  hasUnknownTokens: boolean;
  totalCostUsd: number;
  /** True when at least one row in this model's group had no priced cost (no rate configured, or no usage reported). */
  hasUnknownCost: boolean;
};

const METRIC_VALUE: Record<GenerationMetric, (entry: GenerationModelBreakdown) => number> = {
  count: (entry) => entry.count,
  tokens: (entry) => entry.totalTokens,
  cost: (entry) => entry.totalCostUsd,
};

/**
 * Ranked breakdown for the bar chart: every distinct model that appears in
 * `rows`, with count/tokens/cost all computed together (one pass) so switching
 * the displayed metric in the UI never needs a second query. `sortBy` picks
 * which of the three ranks the list — always the metric currently on screen, so
 * the chart's order and its values never disagree with each other.
 */
export function groupByModel(
  rows: readonly GenerationRecord[],
  sortBy: GenerationMetric = "count",
): GenerationModelBreakdown[] {
  const groups = new Map<string, GenerationModelBreakdown>();
  for (const row of rows) {
    const existing = groups.get(row.model) ?? {
      model: row.model,
      count: 0,
      share: 0,
      totalTokens: 0,
      hasUnknownTokens: false,
      totalCostUsd: 0,
      hasUnknownCost: false,
    };
    existing.count += 1;
    if (row.totalTokens == null) existing.hasUnknownTokens = true;
    else existing.totalTokens += row.totalTokens;
    if (row.costUsd == null) existing.hasUnknownCost = true;
    else existing.totalCostUsd += row.costUsd;
    groups.set(row.model, existing);
  }

  const total = rows.length;
  const valueOf = METRIC_VALUE[sortBy];
  return Array.from(groups.values())
    .map((entry) => ({ ...entry, share: total > 0 ? entry.count / total : 0 }))
    .sort((a, b) => valueOf(b) - valueOf(a) || a.model.localeCompare(b.model));
}

export type GenerationDayPoint = { date: string; value: number };

/**
 * Day-by-day total (UTC calendar day) of whichever metric the caller asks for —
 * feeds directly into MetricChart's SeriesPoint shape. F213 AC2: "aggregate AI
 * spend over a time period, not just a running total" — this is that period
 * breakdown, one point per day that actually had at least one generation
 * (no zero-filled gaps: a quiet day is absent, not a drawn zero).
 */
export function groupByDay(
  rows: readonly GenerationRecord[],
  metric: GenerationMetric,
): GenerationDayPoint[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const day = row.createdAt.slice(0, 10); // ISO date prefix, UTC by construction (timestamptz -> ISO string)
    const value = metric === "count" ? 1 : metric === "tokens" ? (row.totalTokens ?? 0) : (row.costUsd ?? 0);
    totals.set(day, (totals.get(day) ?? 0) + value);
  }
  return Array.from(totals.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
