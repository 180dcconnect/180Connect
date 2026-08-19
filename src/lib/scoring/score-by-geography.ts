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
// AC2 is meaningfully different from F089's flat per-category ranking:
// geography scoring must be RELATIVE to "the branch's stated geographic
// focus" — a client in the priority region should score higher than one
// outside it, not every location treated identically. Rather than
// hardcoding a specific priority region (which isn't confirmed anywhere,
// and might belong in a settings table, an env var, or somewhere else
// entirely — genuinely not our decision to place), this function takes the
// priority regions as a parameter. Whatever eventually reads the real
// "branch focus" setting can pass it straight in.
//
// AC3: a client with no location recorded gets an explicit default
// treatment, not an error or a silent zero.

export type GeographyScoreResult = {
  score: number;
  usedDefault: boolean;
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
 * AC3: explicit default for a missing location, distinct from scoring as
 * if the client were confirmed outside every priority region.
 */
const DEFAULT_FOR_MISSING_LOCATION = 0.5;

export function scoreByGeography(
  location: string | null | undefined,
  priorityRegions: readonly string[],
): GeographyScoreResult {
  const trimmed = location?.trim();

  if (!trimmed) {
    return {
      score: DEFAULT_FOR_MISSING_LOCATION,
      usedDefault: true,
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
    matchedPriorityRegion: matched,
  };
}
