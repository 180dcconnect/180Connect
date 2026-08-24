// F092: Score by Partnership History — pure calculation logic.
//
// Real blocker: "Blocked By: Availability of reliable partnership data" —
// unlike F089/F090/F091, the underlying data source (360Giving grants,
// F035) does appear to already exist as a real `grants` table in the
// database, confirmed earlier. The open question here is about data
// *reliability*, not existence — so this function is written to accept a
// matched-grant count directly, ready to be fed real data once whatever
// matches organisations to 360Giving records (mentioned in AC1) exists.
//
// AC2: "no matched history" must not be penalised, explicitly not treated
// as worse than having real history. The ticket doesn't distinguish
// between "never checked" and "checked, found nothing" — both null/
// undefined (no match attempted) and 0 (matched, confirmed no grants) are
// treated identically here: neither is assumed to reflect badly on the
// organisation, matching AC2's own reasoning ("not penalised for missing
// data it was never going to have").
//
// AC3: adjustable/disableable weight independently of other parameters —
// same as F091's AC3, this is naturally satisfied by this function only
// ever producing its own standalone 0-1 score; F088's calculatePriorityScore
// combines per-parameter scores with independent per-parameter weights by
// design, no special handling needed here.

export type PartnershipScoreResult = {
  score: number;
  hasMatchedHistory: boolean;
};

/**
 * TODO: placeholder scaling, not a real decision — the ticket's "Blocked
 * By" note flags data reliability as unresolved, and no scale for "how
 * much history is a lot" has been confirmed. Any matched grant count above
 * 0 scores higher than no history; more grants scores progressively
 * higher, capped once further grants stop meaningfully increasing the
 * score.
 */
const NO_HISTORY_SCORE = 0.5;
const MAX_BONUS_SCORE = 0.9;
const GRANTS_FOR_MAX_BONUS = 5;

export function scoreByPartnershipHistory(
  matchedGrantCount: number | null | undefined,
): PartnershipScoreResult {
  if (
    matchedGrantCount === null ||
    matchedGrantCount === undefined ||
    Number.isNaN(matchedGrantCount) ||
    matchedGrantCount <= 0
  ) {
    return { score: NO_HISTORY_SCORE, hasMatchedHistory: false };
  }

  const ratio = Math.min(matchedGrantCount / GRANTS_FOR_MAX_BONUS, 1);
  const score = NO_HISTORY_SCORE + ratio * (MAX_BONUS_SCORE - NO_HISTORY_SCORE);

  return { score, hasMatchedHistory: true };
}
