// F213 — LLM Cost Tracking (#208): prices one generation's token usage against
// MODEL_PRICING, kept pure and DB-free so it's testable without a network call or
// Supabase — same split as build-prompt.ts and detect-field-discrepancies.ts.

export type ModelPricingRate = {
  inputUsdPer1kTokens: number;
  outputUsdPer1kTokens: number;
};

export type GenerationUsage = {
  inputTokens: number | null | undefined;
  outputTokens: number | null | undefined;
};

/**
 * Null, never 0, whenever the answer isn't actually known — both when no rate is
 * configured for the model (`pricing` is null) and when the provider reported no
 * usage at all. A generation with only one side of the usage reported (e.g. an
 * input count but no output count) still prices with the side it has; treating a
 * missing count as 0 there is a reasonable estimate, not a fabricated total —
 * unlike the "no rate" and "no usage at all" cases, which have nothing to
 * estimate from.
 */
export function computeCostUsd(usage: GenerationUsage, pricing: ModelPricingRate | null): number | null {
  if (!pricing) return null;
  if (usage.inputTokens == null && usage.outputTokens == null) return null;

  const inputCost = ((usage.inputTokens ?? 0) / 1000) * pricing.inputUsdPer1kTokens;
  const outputCost = ((usage.outputTokens ?? 0) / 1000) * pricing.outputUsdPer1kTokens;
  // Rounded to the same 6 decimal places AI_GENERATIONS.cost_usd stores (numeric(12,6)) —
  // computed here rather than left to Postgres, so the value the app logs/tests is
  // exactly the value that lands in the row, not a silently-truncated neighbour of it.
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
