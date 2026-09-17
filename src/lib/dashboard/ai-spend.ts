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
  "email_regeneration",
  "follow_up_email",
  "client_booklet",
  "other",
];

/**
 * `ai_generations.activity` is free text, and rows written before the column
 * existed carry null. Anything this list does not name lands in Other rather
 * than being dropped or mislabelled as an initial email.
 */
export function toAiGenerationActivity(value: string | null | undefined): AiGenerationActivity {
  return value && (AI_GENERATION_ACTIVITIES as readonly string[]).includes(value)
    ? (value as AiGenerationActivity)
    : "other";
}

const DAY_MS = 86_400_000;

export type AiSpendPeriodId = "month" | "30d" | "90d" | "365d";

export type AiSpendPeriod = {
  id: AiSpendPeriodId;
  /** What the control says. Plain words — this is a choice, not a config value. */
  label: string;
  /** Length of the window in days, or `null` for month to date (the 1st → today). */
  days: number | null;
  /**
   * What the move is measured against, as the sentence's own words. It sits
   * after "on", so "on the same stretch of last month".
   */
  comparison: string;
};

/**
 * The windows the spend card offers, longest last. Deliberately the same
 * family of choices as the dashboard's Total Organisations card, so two
 * controls on one screen do not teach two vocabularies.
 *
 * No "all time": the read behind the card is bounded by the widest period
 * here, and an unbounded window would mean fetching every generation ever
 * written on every dashboard load.
 */
export const AI_SPEND_PERIODS: readonly AiSpendPeriod[] = [
  {
    id: "month",
    label: "This month",
    days: null,
    comparison: "the same stretch of last month",
  },
  { id: "30d", label: "Past 30 days", days: 30, comparison: "the 30 days before" },
  { id: "90d", label: "Last 3 months", days: 90, comparison: "the 3 months before" },
  { id: "365d", label: "Last 12 months", days: 365, comparison: "the 12 months before" },
];

export const DEFAULT_AI_SPEND_PERIOD = AI_SPEND_PERIODS[0];

export type SpendWindow = { fromMs: number; toMs: number };

/** The window a period reads: month to date, or the last N calendar days. */
export function aiSpendPeriodWindow(
  period: AiSpendPeriod = DEFAULT_AI_SPEND_PERIOD,
  now: Date = new Date(),
): SpendWindow {
  const toMs = now.getTime();
  if (period.days === null) {
    return { fromMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), toMs };
  }
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { fromMs: startOfToday - (period.days - 1) * DAY_MS, toMs };
}

/**
 * The equal-length stretch immediately before a window, which the delta is
 * measured against. Equal-length rather than "the whole of the previous
 * period": half a month of spend against a full one would read as a halving
 * every month, and 30 days against a 31-day month as a rise.
 *
 * Reaches back past the 1st of the previous month after a short one — 31 March
 * compares against a stretch running to 29 January — because fetching from the
 * 1st would count days that really are missing as zero spend and inflate the %.
 */
export function aiSpendPriorWindow(
  period: AiSpendPeriod = DEFAULT_AI_SPEND_PERIOD,
  now: Date = new Date(),
): SpendWindow {
  const { fromMs, toMs } = aiSpendPeriodWindow(period, now);
  return { fromMs: fromMs - (toMs - fromMs), toMs: fromMs };
}

/**
 * Earliest instant **any** offered period needs — every period's own prior
 * stretch, whichever reaches back furthest. This is what the dashboard fetches
 * from; a shorter fetch silently understates the longest window and reports no
 * comparison for it, because the rows simply are not there to count.
 */
export function aiSpendFetchStart(now: Date = new Date()): Date {
  return new Date(
    Math.min(
      ...AI_SPEND_PERIODS.map((period) => {
        const { fromMs, toMs } = aiSpendPeriodWindow(period, now);
        return fromMs - (toMs - fromMs);
      }),
    ),
  );
}

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
  /** ISO day the current period starts (the 1st, or N days back). */
  periodFrom: string;
  /** ISO day the current period ends (today, at the time the dashboard was read). */
  periodTo: string;
  /** Which of `AI_SPEND_PERIODS` this reading is for. */
  periodId: AiSpendPeriodId;
  spendByDay: AiSpendBucket[];
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
 * One period's spend, with the equal-length prior stretch for comparison.
 *
 * Every period is the same arithmetic over the same rows, so the card's
 * dropdown cannot disagree with the number above it: switching the window
 * re-reads the rows through this, it does not adjust the total.
 */
export function aiSpendSummary(
  rows: readonly AiGenerationCostRow[],
  now: Date = new Date(),
  period: AiSpendPeriod = DEFAULT_AI_SPEND_PERIOD,
): AiSpendSummary {
  const { fromMs: monthStartMs, toMs: nowMs } = aiSpendPeriodWindow(period, now);
  const priorFromMs = aiSpendPriorWindow(period, now).fromMs;

  let costUsd = 0;
  let priorCostUsd = 0;
  let generations = 0;
  let unpriced = 0;
  let totalTokens = 0;
  const models = new Set<string>();
  const spendByDay = new Map<string, AiSpendBucket>();
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
        const bucket = spendByDay.get(key) ?? {
          key,
          label: formatSpendDay(key),
          totalCostUsd: 0,
          byActivity: emptyActivity(),
        };
        bucket.totalCostUsd += cost;
        bucket.byActivity[activity] += cost;
        spendByDay.set(key, bucket);
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
    periodTo: new Date(nowMs).toISOString().slice(0, 10),
    periodId: period.id,
    spendByDay: Array.from(spendByDay.values()).sort((a, b) => a.key.localeCompare(b.key)),
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

/**
 * One colour per activity, for the stick instruments that split a month's
 * spend. These are data colours — the categories are ours, and five of them
 * have to be told apart at 3px — not the app's state palette, which is why
 * "Initial email" is `--lead` rather than anything from `go`/`hold`/`stop`.
 *
 * The four state tones would be the wrong vocabulary here twice over: they
 * would say a category is good or bad, and there are not four of them. State
 * still comes from `Pill`. `--brand` (2.3:1 on white) is here as a *mark*, the
 * one job the colour doc leaves it: never app text, never a heading.
 *
 * These five are the chart's existing colours, moved here from the card so the
 * gauge, the legend and any future split all read the same month the same way.
 */
export const AI_GENERATION_ACTIVITY_COLOURS: Record<AiGenerationActivity, string> = {
  initial_email: "var(--lead)",
  email_regeneration: "var(--hold)",
  follow_up_email: "var(--brand)",
  client_booklet: "var(--scored)",
  other: "var(--faint)",
};

/**
 * `"58%"`, and `"<1%"` rather than a round zero — a category that cost
 * something must never read as having cost nothing.
 */
export function formatShare(share: number): string {
  if (share <= 0) return "0%";
  if (share < 0.005) return "<1%";
  return `${Math.round(share * 100 + 1e-9)}%`;
}

const SPEND_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const SPEND_DAY_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * `"2026-09-12"` → `"12 Sep"`, or `"12 Sep 2026"` where the span crosses a
 * year and the year is the only thing telling one end from the other. Off the
 * ISO day rather than a local `Date`, so the dashboard and the admin page
 * cannot name the same day two ways.
 */
export function formatSpendDay(isoDay: string, withYear = false): string {
  const day = new Date(`${isoDay}T00:00:00Z`);
  return (withYear ? SPEND_DAY_YEAR : SPEND_DAY).format(day);
}

export type AiSpendActivityRow = {
  activity: AiGenerationActivity;
  label: string;
  /** A CSS colour reference — the segment fill and its legend dot. */
  colour: string;
  /** Priced cost in the period. 0 where the activity ran but nothing was billed. */
  costUsd: number;
  /** 0–1 of the period's priced spend. 0 when nothing in the period was priced. */
  share: number;
  generations: number;
  unpriced: number;
};

/**
 * The month's spend split by activity — the same figures the per-day buckets
 * carry, read at the level the budget question is actually asked ("what are we
 * spending it on").
 *
 * Ordered by cost, largest first, so the instrument's leftmost segment is the
 * biggest line item. Rows **that ran but were never priced** are kept, at the
 * end and at zero: a booklet generated for a model with no pricing row is
 * spend we cannot name a figure for, and dropping it would let the split add up
 * to the headline while quietly omitting part of it.
 */
/**
 * Whether a window crosses a year. Its ends need the year when it does, or
 * "12 Sept – 16 Sept" reads as nine days and is really twelve months.
 */
export function aiSpendSpansYears(summary: AiSpendSummary): boolean {
  return summary.periodFrom.slice(0, 4) !== summary.periodTo.slice(0, 4);
}

/** `"17 Sept 2025 – 16 Sept 2026"`, for a heading or a chart's own label. */
export function aiSpendRangeLabel(summary: AiSpendSummary): string {
  const withYear = aiSpendSpansYears(summary);
  return `${formatSpendDay(summary.periodFrom, withYear)} – ${formatSpendDay(summary.periodTo, withYear)}`;
}

export type AiSpendReading = {
  period: AiSpendPeriod;
  summary: AiSpendSummary;
};

/**
 * Every offered period's reading, off one set of rows.
 *
 * Computed together rather than on demand because the dashboard has already
 * paid for the widest fetch, and switching the dropdown must not cost a round
 * trip — the picker is a choice between four readings of the same data, not a
 * new query.
 */
export function aiSpendReadings(
  rows: readonly AiGenerationCostRow[],
  now: Date = new Date(),
): AiSpendReading[] {
  return AI_SPEND_PERIODS.map((period) => ({
    period,
    summary: aiSpendSummary(rows, now, period),
  }));
}

export function aiSpendActivityRows(summary: AiSpendSummary): AiSpendActivityRow[] {
  const rows = AI_GENERATION_ACTIVITIES.map((activity) => {
    const totals = summary.activityTotals[activity];
    return {
      activity,
      label: AI_GENERATION_ACTIVITY_LABELS[activity],
      colour: AI_GENERATION_ACTIVITY_COLOURS[activity],
      costUsd: totals.costUsd,
      share: summary.costUsd > 0 ? totals.costUsd / summary.costUsd : 0,
      generations: totals.generations,
      unpriced: totals.unpriced,
    };
  }).filter((row) => row.generations > 0);

  return rows.sort((a, b) => {
    if (a.costUsd !== b.costUsd) return b.costUsd - a.costUsd;
    // Costless rows keep the canonical activity order among themselves.
    return (
      AI_GENERATION_ACTIVITIES.indexOf(a.activity) -
      AI_GENERATION_ACTIVITIES.indexOf(b.activity)
    );
  });
}
