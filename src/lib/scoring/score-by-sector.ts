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
// AC1: sector contributes according to a ranking. The ticket's open question
// ("Sector weight") was resolved with a provisional v1 ranking — see
// SECTOR_CATEGORY_SCORES below for the per-category rationale. It is the first
// working ordering, not a final answer: adjusting it later is an edit to one
// map, nothing else.
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
 * Provisional v1 sector ranking (first-ever score set by PM decision, Aug 2026),
 * grounded in what evidence exists rather than invented wholesale:
 *
 * - Health & Wellbeing — 0.7. The only sector-level preference documented in
 *   branch strategy: docs/client-criteria.md (F047) states "Healthcare
 *   alignment is desirable".
 * - Education & Youth — 0.65. Natural mission fit for a student-led branch;
 *   deep pool of local schools/college-adjacent orgs with well-scoped projects.
 * - Poverty & Community — 0.6. Grassroots community orgs are the core 180DC
 *   client profile, and the South Yorkshire pilot region has high deprivation
 *   (docs/client-criteria.md prioritises Sheffield/Rotherham/Barnsley/Doncaster).
 * - Social Justice & Enterprise — 0.55. Social enterprises have revenue models,
 *   which make for richer strategy projects and more engaged clients.
 * - Environment & Sustainability — 0.45. Growing demand and strong student
 *   interest, but fewer established organisations locally and thinner
 *   consultant expertise to draw on today.
 * - Arts, Culture & Heritage — 0.4. Valid clients, but typically small
 *   volunteer-run orgs with limited capacity to act on recommendations.
 *
 * Constraints that must survive any future edit: every category keeps a
 * DISTINCT value (so cross-category sector edits always recalculate), and none
 * equals the neutral 0.5 default (so adding or removing a recorded sector
 * always moves the score).
 */
const SECTOR_CATEGORY_SCORES = {
  "Health & Wellbeing": 0.7,
  "Education & Youth": 0.65,
  "Poverty & Community": 0.6,
  "Social Justice & Enterprise": 0.55,
  "Environment & Sustainability": 0.45,
  "Arts, Culture & Heritage": 0.4,
} as const satisfies Record<string, number>;

/**
 * Standard sector taxonomy mirrored from SECTOR_CATEGORY_GROUPS (F197) in
 * src/app/settings/outreach-preferences/constants.ts — same categories, presets
 * AND declaration order (order decides tie-breaks here), enforced by the
 * taxonomy-sync test in score-by-sector.test.ts. See the header note about why
 * it is copied rather than imported. Exported for the taxonomy-sync test.
 */
export const SECTOR_TAXONOMY = {
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
  "Environment & Sustainability": [
    "Environment & Conservation",
    "Climate & Sustainability",
    "Renewable Energy",
    "Animal Welfare",
  ],
  "Poverty & Community": [
    "Poverty Relief",
    "Housing & Homelessness",
    "Community Development",
    "Social Inclusion",
  ],
  "Arts, Culture & Heritage": [
    "Arts & Culture",
    "Heritage & Museums",
    "Sports & Recreation",
  ],
  "Social Justice & Enterprise": [
    "Social Enterprise",
    "International Aid",
    "Human Rights & Justice",
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

/**
 * Minimum length for the loose "term contains value" direction. Without it,
 * degenerate one-character free text ("a", "&") matches every preset via
 * substring containment and silently scores the maximum category.
 */
const MIN_LOOSE_MATCH_LENGTH = 4;

function matchesTerm(value: string, term: string): boolean {
  const v = value.toLowerCase();
  const t = term.toLowerCase();
  if (v.includes(t)) return true;
  return v.length >= MIN_LOOSE_MATCH_LENGTH && t.includes(v);
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
        score: SECTOR_CATEGORY_SCORES[
          category as keyof typeof SECTOR_CATEGORY_SCORES
        ],
        usedDefault: false,
        matchedTaxonomy: true,
        matchedCategory: category,
      };
    }

    if (presets.some((preset) => trimmed.toLowerCase() === preset.toLowerCase())) {
      return {
        score: SECTOR_CATEGORY_SCORES[
          category as keyof typeof SECTOR_CATEGORY_SCORES
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
        score: SECTOR_CATEGORY_SCORES[
          category as keyof typeof SECTOR_CATEGORY_SCORES
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
