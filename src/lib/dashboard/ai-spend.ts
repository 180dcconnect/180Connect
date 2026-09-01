/**
 * F213 — month-to-date AI spend, as a dashboard reading.
 *
 * `/admin/ai-generations` already lists every generation with its cost, which
 * answers "what did this email cost". It does not answer the question that
 * actually matters to whoever owns the budget: "what are we spending this
 * month, and is it accelerating". That is one number, and nobody was watching
 * it — AI spend is the one line item on this platform that can quietly multiply
 * without anybody changing anything.
 *
 * NOT a duplicate of ../outreach/generation-history.ts, which owns the admin
 * page's per-model and per-day breakdowns over already-mapped camelCase records.
 * This is the single month-to-date reading, taken off raw DB rows, and it needs
 * the equal-length prior stretch that a day-series doesn't carry. If a third
 * caller ever wants both, the mapping is the thing to share, not the aggregate.
 *
 * NULL COST IS NOT ZERO COST. `AI_GENERATIONS.cost_usd` is null when the
 * provider omitted usage data or no MODEL_PRICING row covered the model at
 * generation time (see 20260831100200_add_usage_to_ai_generations.sql, which is
 * explicit that null must never be fabricated as 0). Treating those as free
 * would understate real spend, so they are counted separately and surfaced —
 * "£12.40 across 300 generations, 8 unpriced" is honest; "£12.40" alone is not.
 */

export type AiGenerationActivity = "initial_email" | "follow_up_email" | "email_regeneration" | "client_booklet" | "other";

export type AiGenerationCostRow = {
  created_at: string;
  cost_usd: number | string | null;
  total_tokens: number | null;
  model: string | null;
  /** The linked activity classification; unknown records remain visible as Other. */
  activity?: AiGenerationActivity;
};

export type AiActivityCostRow = AiGenerationCostRow & {
  activity: AiGenerationActivity;
};

export type AiSpendBucket = {
  key: string;
  label: string;
  totalCostUsd: number;
  byActivity: Record<AiGenerationActivity, number>;
};

export const AI_GENERATION_ACTIVITIES: readonly AiGenerationActivity[] = [
  "initial_email",
  "follow_up_email",
  "client_booklet",
  "other",
];

export const AI_GENERATION_ACTIVITY_LABELS: Record<AiGenerationActivity, string> = {
  initial_email: "Initial email",
  follow_up_email: "Follow-up email",
  email_regeneration: "Email regeneration",
  client_booklet: "Client booklet",
  other: "Other",
};

export type AiSpendSummary = {
  /** Summed cost of the priced generations in the current period, USD. */
  costUsd: number;
  /** Same for the equal-length preceding period, for the delta. */
  priorCostUsd: number;
  /** Generations in the current period, priced or not. */
  generations: number;
  /** Of those, how many carried no cost — the figure above is a floor, not a total. */
  unpriced: number;
  totalTokens: number;
  /** Distinct models billed in the period, name-sorted. */
  models: string[];
  /** ISO day the current period starts (the 1st of the month). */
  periodFrom: string;
  spendByWeek: AiSpendBucket[];
  /** Cost-bearing and unpriced generations grouped by activity. */
  activityTotals: Record<AiGenerationActivity, { costUsd: number; generations: number; unpriced: number; totalTokens: number }>;
};

/**
 * `cost_usd` is `numeric(12,6)`, which postgrest-js may hand back as a string
 * to avoid float rounding. Parse rather than coerce, and reject anything
 * unparseable as "unpriced" instead of silently adding NaN to the total.
 */
function parseCost(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Month-to-date spend, with the equal-length prior stretch for comparison.
 *
 * Equal-length rather than "all of last month", for the same reason as
 * ./conversions-over-time.ts: 15 days of spend against 31 would read as a
 * halving every month.
 */
export function aiSpendSummary(
  rows: readonly AiGenerationCostRow[],
  now: Date = new Date(),
): AiSpendSummary {
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const nowMs = now.getTime();
  const span = nowMs - monthStartMs;
  const priorFromMs = monthStartMs - span;

  let costUsd = 0;
  let priorCostUsd = 0;
  let generations = 0;
  let unpriced = 0;
  let totalTokens = 0;
  const models = new Set<string>();
  const spendByWeek = new Map<string, AiSpendBucket>();
  const activityTotals: AiSpendSummary["activityTotals"] = {
    initial_email: { costUsd: 0, generations: 0, unpriced: 0, totalTokens: 0 },
    follow_up_email: { costUsd: 0, generations: 0, unpriced: 0, totalTokens: 0 },
    email_regeneration: { costUsd: 0, generations: 0, unpriced: 0, totalTokens: 0 },
    client_booklet: { costUsd: 0, generations: 0, unpriced: 0, totalTokens: 0 },
    other: { costUsd: 0, generations: 0, unpriced: 0, totalTokens: 0 },
  };
  const emptyActivity = (): Record<AiGenerationActivity, number> => ({
    initial_email: 0,
    follow_up_email: 0,
    email_regeneration: 0,
    client_booklet: 0,
    other: 0,
  });

  for (const row of rows) {
    const at = Date.parse(row.created_at);
    if (Number.isNaN(at)) continue;
    const cost = parseCost(row.cost_usd);

    if (at >= monthStartMs && at <= nowMs) {
      generations += 1;
      const activity = row.activity ?? "other";
      const activityTotal = activityTotals[activity];
      activityTotal.generations += 1;
      if (cost === null) {
        unpriced += 1;
        activityTotal.unpriced += 1;
      } else {
        costUsd += cost;
        activityTotal.costUsd += cost;
        const date = new Date(at);
        const key = date.toISOString().slice(0, 10);
        const bucket = spendByWeek.get(key) ?? {
          key,
          label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
          totalCostUsd: 0,
          byActivity: emptyActivity(),
        };
        bucket.totalCostUsd += cost;
        bucket.byActivity[activity] += cost;
        spendByWeek.set(key, bucket);
      }
      if (row.total_tokens && row.total_tokens > 0) {
        totalTokens += row.total_tokens;
        activityTotal.totalTokens += row.total_tokens;
      }
      if (row.model) models.add(row.model);
      continue;
    }

    if (at >= priorFromMs && at < monthStartMs && cost !== null) {
      priorCostUsd += cost;
    }
  }

  return {
    costUsd,
    priorCostUsd,
    generations,
    unpriced,
    totalTokens,
    models: Array.from(models).sort((a, b) => a.localeCompare(b)),
    periodFrom: new Date(monthStartMs).toISOString().slice(0, 10),
    spendByWeek: Array.from(spendByWeek.values()).sort((a, b) => a.key.localeCompare(b.key)),
    activityTotals,
  };
}

/**
 * Percent change against the prior stretch, or null when there is nothing to
 * compare against — an unqualified "+100%" off a zero baseline reads as an
 * emergency and means "we started using it".
 */
export function aiSpendChange(summary: AiSpendSummary): number | null {
  if (summary.priorCostUsd <= 0) return null;
  return ((summary.costUsd - summary.priorCostUsd) / summary.priorCostUsd) * 100;
}

/**
 * USD to 2dp for anything a person reads, except sub-cent totals, where 2dp
 * rounds a real cost to "$0.00" and makes the tile look broken.
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}
