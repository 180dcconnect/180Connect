// F089: Score by Sector — pure calculation logic.
//
// ORGANISATIONS.sector exists as of 20260824100000_add_sector_to_organisations.sql,
// but its values are LLM-classified free text (enrichment-populated); there is
// still no canonical enum (F055 not built). A standard taxonomy DOES exist since
// the F197 work: SECTOR_CATEGORY_GROUPS in
// src/app/settings/outreach-preferences/constants.ts synthesises Charity
// Commission causes, Companies House SIC codes and 180DC focus areas into six
// categories. That taxonomy lives in the settings layer, so it is mirrored here
// rather than imported upwards (lib must not depend on app/); consolidate into a
// single shared module when F055 defines the real classification.
//
// AC1: sector contributes according to a ranking. The ticket's own "Blocked By"
// note flags the real sector weight/ranking as an open question the team has
// NOT decided. Like F090's geography placeholders, PLACEHOLDER_CATEGORY_SCORES
// below are deliberately marked stand-ins: the point is that each category has
// its own defined value, so changing a client's sector between categories
// actually moves the score today, and swapping in the team's real ranking later
// is an edit to one map, nothing else. Do not read the current ordering as a
// product decision.
//
// AC3: a client with no sector recorded gets explicit default treatment, not an
// error or a silent zero — see DEFAULT_FOR_MISSING_SECTOR below.

export type SectorScoreResult = {
  score: number;
  /** True when the client had no usable sector value (missing/blank). */
  usedDefault: boolean;
  /** True when the value matched the standard sector taxonomy. */
  matchedTaxonomy: boolean;
  /** The matched taxonomy category, or null when unmatched/missing. */
  matchedCategory: string | null;
};

/**
 * TODO: placeholder ranking, not a real decision — replace these values with
 * the team's confirmed per-category weights once the "Sector weight" question
 * is settled. Constraints that matter more than the current numbers:
 * every category has a DISTINCT value (so cross-category sector edits always
 * recalculate), none equals the neutral 0.5 (so adding or removing a recorded
 * sector always moves the score away from/towards the default).
 */
const PLACEHOLDER_CATEGORY_SCORES = {
  "Health & Wellbeing": 0.7,
  "Education & Youth": 0.65,
  "Poverty & Community": 0.6,
  "Social Justice & Enterprise": 0.55,
  "Environment & Sustainability": 0.45,
  "Arts, Culture & Heritage": 0.4,
} as const satisfies Record<string, number>;

/**
 * Standard sector taxonomy mirrored from SECTOR_CATEGORY_GROUPS (F197) in
 * src/app/settings/outreach-preferences/constants.ts — see the header note
 * about why it is copied rather than imported.
 */
const SECTOR_TAXONOMY = {
  "Health & Wellbeing": [
    "Health & Social Care",
    "Mental Health",
    "Disability Support",
    "Medical Research",
  ],
  "Education & Youth": [
    "Education & Training",
    "Youth & Children",
    "Schools & Colleges",
    "Skills & Employment",
  ],
  "Poverty & Community": [
    "Poverty Relief",
    "Housing & Homelessness",
    "Community Development",
    "Social Inclusion",
  ],
  "Social Justice & Enterprise": [
    "Social Enterprise",
    "International Aid",
    "Human Rights & Justice",
  ],
  "Environment & Sustainability": [
    "Environment & Conservation",
    "Climate & Sustainability",
    "Renewable Energy",
    "Animal Welfare",
  ],
  "Arts, Culture & Heritage": [
    "Arts & Culture",
    "Heritage & Museums",
    "Sports & Recreation",
  ],
} as const;

/**
 * Neutral score shared by the two "no usable signal" outcomes (mirrors F090):
 * a MISSING sector (AC3's explicit default — unknown neither gains nor loses),
 * and free text that does not match the taxonomy (scored, not defaulted, but
 * carrying no ranking signal until enrichment classifies it). Distinct flags
 * (`usedDefault` vs `matchedTaxonomy`) let callers tell them apart.
 */
const NEUTRAL_NO_SIGNAL_SCORE = 0.5;

function matchesTerm(value: string, term: string): boolean {
  const v = value.toLowerCase();
  const t = term.toLowerCase();
  return v.includes(t) || t.includes(v);
}

export function scoreBySector(
  sector: string | null | undefined,
): SectorScoreResult {
  const trimmed = sector?.trim();

  if (!trimmed) {
    return {
      score: NEUTRAL_NO_SIGNAL_SCORE,
      usedDefault: true,
      matchedTaxonomy: false,
      matchedCategory: null,
    };
  }

  // Exact preset/category names win over loose substring matches, and earlier
  // categories win ties — enrichment free text like "youth mental health"
  // lands deterministically instead of depending on iteration luck.
  for (const [category, presets] of Object.entries(SECTOR_TAXONOMY)) {
    if (trimmed.toLowerCase() === category.toLowerCase()) {
      return {
        score: PLACEHOLDER_CATEGORY_SCORES[
          category as keyof typeof PLACEHOLDER_CATEGORY_SCORES
        ],
        usedDefault: false,
        matchedTaxonomy: true,
        matchedCategory: category,
      };
    }

    if (presets.some((preset) => trimmed.toLowerCase() === preset.toLowerCase())) {
      return {
        score: PLACEHOLDER_CATEGORY_SCORES[
          category as keyof typeof PLACEHOLDER_CATEGORY_SCORES
        ],
        usedDefault: false,
        matchedTaxonomy: true,
        matchedCategory: category,
      };
    }
  }

  for (const [category, presets] of Object.entries(SECTOR_TAXONOMY)) {
    if (
      presets.some((preset) => matchesTerm(trimmed, preset)) ||
      matchesTerm(trimmed, category)
    ) {
      return {
        score: PLACEHOLDER_CATEGORY_SCORES[
          category as keyof typeof PLACEHOLDER_CATEGORY_SCORES
        ],
        usedDefault: false,
        matchedTaxonomy: true,
        matchedCategory: category,
      };
    }
  }

  return {
    score: NEUTRAL_NO_SIGNAL_SCORE,
    usedDefault: false,
    matchedTaxonomy: false,
    matchedCategory: null,
  };
}
