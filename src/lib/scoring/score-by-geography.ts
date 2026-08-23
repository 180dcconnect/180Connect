// F090: Score by Geography — pure calculation logic.
//
// Real blocker, same pattern as F089: "Blocked By: Geography weight" is an
// open question, and this depends on F054 ("standardised location data"),
// which isn't built as its own ticket yet. Unlike F089's sector, though,
// ORGANISATIONS does already have real location fields (city, country_code,
// geographic_reach) — so this function is written to take a location value
// directly, ready to be fed real data as soon as it's read from those
// existing columns, without needing F054 to add anything new first.
//
// WHICH FIELDS THIS SCORES — the city path only:
//
//   location       → ORGANISATIONS.city
//   priorityRegions → OUTREACH_PREFERENCES.preferred_cities (the CAM/branch's
//                    stated geographic focus; the settings table already
//                    stores free-text city lists there)
//
// This is deliberately NOT the geographic_reach path. Reach-based scoring
// (local/regional/national/international, with the South Yorkshire pilot
// expansion) already lives in getGeographicPriorityScore in
// src/app/clients/visible-clients.ts for personal queue ordering; that stays
// separate. When this function is wired into calculatePriorityScore's
// `geography` factor it should be fed city data, and reach handling either
// composed alongside or kept queue-only — not duplicated here.
//
// AC2: geography scoring must be RELATIVE to "the branch's stated geographic
// focus" — a client in the priority region should score higher than one
// outside it, not every location treated identically. Rather than hardcoding
// a specific priority region, this function takes them as a parameter;
// whatever reads preferred_cities (or a future branch-level setting) passes
// them straight in.
//
// AC3: a client with no location recorded gets an explicit default
// treatment, not an error or a silent zero. The neutral score deliberately
// sits BETWEEN non-priority and priority: an unknown location neither gains
// nor loses against a confirmed one until the team decides otherwise.

export type GeographyScoreResult = {
  score: number;
  /** True when the client had no usable location (missing/blank). */
  usedDefault: boolean;
  /**
   * True when the caller passed NO priority regions at all — i.e. "no
   * preference set" per the data dictionary's definition of an empty
   * OUTREACH_PREFERENCES.preferred_cities array. Distinct from a configured
   * preference that simply didn't match: no preference must be NEUTRAL, not
   * a penalty applied to every recorded location.
   */
  noPreferenceSet: boolean;
  matchedPriorityRegion: boolean;
};

/**
 * TODO: placeholder values, not a real decision — the ticket's "Blocked By"
 * note flags the actual geography weight/scoring as unresolved. A location
 * matching a priority region scores higher (AC2); anywhere else scores at
 * a lower, flat placeholder. Real relative values (and whether "priority
 * region" should have gradations, not just in/out) need the team's input.
 */
const PRIORITY_REGION_SCORE = 0.8;
const NON_PRIORITY_REGION_SCORE = 0.3;

/**
 * Neutral score shared by both "no signal" cases (AC3): a missing location,
 * and a caller with no priority regions configured. Sits between the two
 * confirmed outcomes so neither is advantaged by an unknown.
 */
const NEUTRAL_NO_SIGNAL_SCORE = 0.5;

export function scoreByGeography(
  location: string | null | undefined,
  priorityRegions: readonly string[],
): GeographyScoreResult {
  if (priorityRegions.length === 0) {
    // Empty preferred_cities means "no preference set", not "nothing is
    // priority" — treating every recorded location as non-priority here
    // would silently depress every client's geography score whenever a CAM
    // hasn't configured preferences yet.
    return {
      score: NEUTRAL_NO_SIGNAL_SCORE,
      usedDefault: true,
      noPreferenceSet: true,
      matchedPriorityRegion: false,
    };
  }

  const trimmed = location?.trim();

  if (!trimmed) {
    return {
      score: NEUTRAL_NO_SIGNAL_SCORE,
      usedDefault: true,
      noPreferenceSet: false,
      matchedPriorityRegion: false,
    };
  }

  const normalisedLocation = trimmed.toLowerCase();
  const matched = priorityRegions.some(
    (region) => region.trim().toLowerCase() === normalisedLocation,
  );

  return {
    score: matched ? PRIORITY_REGION_SCORE : NON_PRIORITY_REGION_SCORE,
    usedDefault: false,
    noPreferenceSet: false,
    matchedPriorityRegion: matched,
  };
}
