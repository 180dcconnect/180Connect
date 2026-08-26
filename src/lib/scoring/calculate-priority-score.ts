// F088: Base Client Priority Score — pure calculation logic.
//
// Takes already-normalised per-factor scores (0-1 each) rather than raw
// organisation fields; the raw-field-to-factor adapters live in
// score-client.ts (F089-F093's scorers).
//
// F096: the weights are no longer hard-wired. calculatePriorityScore accepts a
// ScoutWeights argument and combines with whatever weights it is given,
// normalising if the weights do not sum to 1 so no submission can push a score
// outside 0-1. DEFAULT_WEIGHTS is what runs before an admin has ever saved a
// change — five-way equal, the MVP formula confirmed with the team lead, now
// including partnership history (F092's scorer exists and the grants data it
// needs is in the database). The weights that actually produced every stored
// score are recorded per generation in MODEL_VERSIONS.config (migration
// 20260831200000); the admin write-path that creates new generations is
// public.set_scout_weights (20260903120000).

export type PriorityFactors = {
  sector: number;
  geography: number;
  size: number;
  partnershipHistory: number;
  previousContact: number;
};

/** The relative weight of each factor. Keys mirror PriorityFactors. */
export type ScoutWeights = PriorityFactors;

/**
 * Equal weighting across all five parameters — the confirmed rule-engine MVP
 * baseline. This is what MODEL_VERSIONS' active SCOUT row is seeded with once
 * F096's migration lands its first reweight; until then v1's four-way config
 * predates the partnership-history parameter.
 */
export const DEFAULT_WEIGHTS: ScoutWeights = {
  sector: 0.2,
  geography: 0.2,
  size: 0.2,
  partnershipHistory: 0.2,
  previousContact: 0.2,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Coerces untrusted weight input (a JSON value out of MODEL_VERSIONS.config or
 * an RPC response) into valid ScoutWeights: each key falls back to its default
 * when missing/non-numeric/out of range, so one bad key degrades to the
 * documented neutral instead of poisoning every score.
 */
export function sanitizeWeights(input: unknown): ScoutWeights {
  const source = typeof input === "object" && input !== null ? input : {};
  const record = source as Record<string, unknown>;
  const pick = (key: keyof ScoutWeights): number => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value)
      ? clamp01(value)
      : DEFAULT_WEIGHTS[key];
  };
  return {
    sector: pick("sector"),
    geography: pick("geography"),
    size: pick("size"),
    partnershipHistory: pick("partnershipHistory"),
    previousContact: pick("previousContact"),
  };
}

/**
 * Combines the five factors into a single 0-1 priority score using the given
 * weights (DEFAULT_WEIGHTS when omitted). Each input is clamped to [0, 1]
 * defensively — an out-of-range factor from any scorer degrades to the nearest
 * valid value rather than producing a score outside the documented 0-1 range.
 */
export function calculatePriorityScore(
  factors: PriorityFactors,
  weights: ScoutWeights = DEFAULT_WEIGHTS,
): number {
  const weighted =
    clamp01(factors.sector) * weights.sector +
    clamp01(factors.geography) * weights.geography +
    clamp01(factors.size) * weights.size +
    clamp01(factors.partnershipHistory) * weights.partnershipHistory +
    clamp01(factors.previousContact) * weights.previousContact;

  const weightSum =
    weights.sector +
    weights.geography +
    weights.size +
    weights.partnershipHistory +
    weights.previousContact;

  // Defensive: weights are configurable now, so not summing to 1 is a normal
  // state an admin can produce — normalise rather than silently producing a
  // score outside 0-1.
  return weightSum === 0 ? 0 : clamp01(weighted / weightSum);
}
