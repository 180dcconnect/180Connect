// F088: Base Client Priority Score — pure calculation logic.
//
// Ticket's own "Blocked By / Open Questions" says: "Initial weighting
// formula" — meaning the real weights are not yet decided by the team.
// EQUAL_WEIGHTS below is a clearly-marked placeholder, not the real
// formula, so this can be swapped for the real one in a single place once
// it's confirmed, without touching anything that calls this function.
//
// Takes already-normalised per-factor scores (0-1 each) rather than raw
// organisation fields, since F089 (sector), F090 (geography), F091 (size),
// and F093 (previous contact) — the tickets that would define how each raw
// field becomes a 0-1 score — don't exist yet either. This function is
// deliberately independent of that unbuilt logic: whichever of F089-F093
// lands first can plug its result straight into the matching field here.

export type PriorityFactors = {
  sector: number;
  geography: number;
  size: number;
  previousContact: number;
};

/**
 * CONFIRMED with team lead: equal weighting for the MVP, matching the
 * ticket's own scope ("Rule-based MVP", the simple sector/geography/size/
 * previous-contact formula described in the ticket, not the larger
 * LATEST_SCORES/MODEL_VERSIONS system found in the Data Model). No longer
 * a placeholder pending a decision — this is the real, agreed formula for
 * now, and can be revisited later if the team wants a weighted version.
 */
export const EQUAL_WEIGHTS: PriorityFactors = {
  sector: 0.25,
  geography: 0.25,
  size: 0.25,
  previousContact: 0.25,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Combines the four factors into a single 0-1 priority score using
 * EQUAL_WEIGHTS. Each input is clamped to [0, 1] defensively — an
 * out-of-range factor (e.g. a bug in one of F089-F093's not-yet-built
 * logic) degrades to the nearest valid value rather than producing a score
 * outside the documented 0-1 range.
 */
export function calculatePriorityScore(factors: PriorityFactors): number {
  const weights = EQUAL_WEIGHTS;
  const weighted =
    clamp01(factors.sector) * weights.sector +
    clamp01(factors.geography) * weights.geography +
    clamp01(factors.size) * weights.size +
    clamp01(factors.previousContact) * weights.previousContact;

  const weightSum =
    weights.sector + weights.geography + weights.size + weights.previousContact;

  // Defensive: if the weights are ever edited to not sum to 1, normalise
  // rather than silently producing a score outside 0-1.
  return weightSum === 0 ? 0 : clamp01(weighted / weightSum);
}