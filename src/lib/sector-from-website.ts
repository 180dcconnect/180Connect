// Reading a sector off an organisation's own website.
//
// ── Why this matches words rather than asking a model ──
//
// The sibling module `mission-from-website.ts` settled the shape of this kind
// of feature: it quotes the description a site publishes about itself and
// returns "nothing to propose" rather than inventing a sentence. Sector is the
// same problem one step on — a site almost never writes "we are Housing &
// Homelessness", so something has to decide — and the same answer holds for the
// same reason. A model asked to classify body copy is fluent, costs money per
// record, and gives an admin nothing to check except its own confidence.
//
// So this counts evidence instead. Each sector in the F197 taxonomy carries a
// list of terms; the proposal is the sector whose terms the site's own words hit
// most, and the matched terms come back with it so the admin sees *why* before
// saving. That makes a wrong proposal visibly wrong ("matched: sport" on a
// hospice) rather than quietly plausible.
//
// ── The rules that keep it honest ──
//
//   * One clear winner or nothing. A tie proposes nothing: two sectors with
//     equal evidence is exactly the case where a guess costs more than a blank,
//     because a wrong sector silently moves a client's priority score while a
//     missing one scores an explicit neutral (score-by-sector.ts AC3).
//   * It writes nothing. It returns a proposal the admin reads, edits and saves
//     through the existing admin edit path, so sector keeps one write surface.
//   * Only values inside the taxonomy. The proposal is always one of
//     SECTOR_TAXONOMY's presets — the same words CAM preferences, the client
//     filters and the scorer use — so a saved proposal can never land outside
//     the vocabulary the rest of the app reads.
//
// The page text is externally authored, so every string here is untrusted input
// downstream — the same contract as mission-from-website.ts (PRD §11.5).

import { extractOrganisation } from "./import/extract-organisation.ts";
import type { PageFetchResult } from "./import/fetch-page.ts";
import { fetchImportPage } from "./import/page-transport.ts";
import { SECTOR_TAXONOMY } from "./scoring/score-by-sector.ts";

/**
 * The terms that count as evidence for each sector, keyed by the taxonomy's own
 * preset names (score-by-sector.ts, mirrored from F197's SECTOR_CATEGORY_GROUPS).
 *
 * Chosen to be words an organisation uses about *itself* — "rough sleeping",
 * "food bank", "apprenticeship" — not words about the sector in the abstract.
 * Every term is matched from a word boundary and allows its own suffixes, so
 * "homeless" covers "homelessness" and "sport" covers "sporting"; that is why
 * no term here is shorter than four characters and why deliberately generic
 * ones ("club", "aid", "art") are written out in longer forms instead. A term
 * that would fire on half the charitable sector earns nothing and costs
 * precision.
 */
export const SECTOR_TERMS: Readonly<Record<string, readonly string[]>> = {
  // Health & Wellbeing
  "Health & Social Care": [
    "health",
    "healthcare",
    "hospice",
    "patient",
    "clinic",
    "social care",
    "carer",
    "palliative",
    "dementia",
    "cancer",
    "nursing",
  ],
  "Mental Health": [
    "mental health",
    "counselling",
    "therapy",
    "therapist",
    "suicide",
    "anxiety",
    "depression",
    "psycholog",
    "emotional wellbeing",
  ],
  "Disability Support": [
    "disability",
    "disabilities",
    "disabled",
    "autism",
    "autistic",
    "wheelchair",
    "sensory impairment",
    "learning difficult",
    "accessible",
  ],
  "Medical Research": [
    "medical research",
    "clinical trial",
    "research into",
    "laboratory",
    "diagnos",
  ],

  // Education & Youth
  "Education & Training": [
    "education",
    "training",
    "literacy",
    "tutoring",
    "numeracy",
    "curriculum",
    "workshops",
    "adult learning",
  ],
  "Youth & Children": [
    "young people",
    "youth",
    "children",
    "childhood",
    "teenager",
    "adolescent",
    "playgroup",
    "young person",
  ],
  "Schools & Colleges": [
    "school",
    "college",
    "sixth form",
    "pupil",
    "classroom",
    "academy trust",
    "nursery",
  ],
  "Skills & Employment": [
    "employability",
    "apprenticeship",
    "skills training",
    "employment support",
    "back into work",
    "jobseeker",
    "careers advice",
  ],

  // Environment & Sustainability
  "Environment & Conservation": [
    "environment",
    "conservation",
    "wildlife",
    "biodiversity",
    "woodland",
    "habitat",
    "nature reserve",
    "countryside",
    "rewilding",
  ],
  "Climate & Sustainability": [
    "climate",
    "sustainability",
    "sustainable",
    "carbon",
    "net zero",
    "recycling",
    "circular economy",
    "waste reduction",
  ],
  "Renewable Energy": [
    "renewable",
    "solar",
    "wind turbine",
    "energy efficiency",
    "green energy",
    "community energy",
  ],
  "Animal Welfare": [
    "animal",
    "rehoming",
    "rescue centre",
    "veterinary",
    "horses",
    "donkey",
    "stray dogs",
  ],

  // Poverty & Community
  "Poverty Relief": [
    "poverty",
    "food bank",
    "foodbank",
    "destitution",
    "hardship",
    "low income",
    "deprivation",
    "emergency food",
    "hunger",
  ],
  "Housing & Homelessness": [
    "homeless",
    "rough sleep",
    "housing",
    "shelter",
    "hostel",
    "tenant",
    "temporary accommodation",
    "sofa surfing",
  ],
  "Community Development": [
    "community centre",
    "local community",
    "neighbourhood",
    "regeneration",
    "community development",
    "village hall",
    "grassroots",
  ],
  "Social Inclusion": [
    "loneliness",
    "isolation",
    "inclusion",
    "marginalised",
    "befriending",
    "integration",
    "excluded",
  ],

  // Arts, Culture & Heritage
  "Arts & Culture": [
    "arts",
    "artist",
    "theatre",
    "music",
    "dance",
    "gallery",
    "creative",
    "festival",
    "performance",
  ],
  "Heritage & Museums": [
    "heritage",
    "museum",
    "historic",
    "archive",
    "listed building",
    "restoration",
    "ancient monument",
  ],
  "Sports & Recreation": [
    "sport",
    "football",
    "cricket",
    "athletics",
    "fitness",
    "recreation",
    "swimming",
    "rugby",
    "coaching",
  ],

  // Social Justice & Enterprise
  "Social Enterprise": [
    "social enterprise",
    "community interest company",
    "trading arm",
    "social impact",
    "reinvest",
  ],
  "International Aid": [
    "international development",
    "overseas",
    "humanitarian",
    "famine",
    "developing countries",
    "global south",
    "disaster relief",
  ],
  "Human Rights & Justice": [
    "human rights",
    "equality",
    "discrimination",
    "asylum",
    "refugee",
    "domestic abuse",
    "advocacy",
    "criminal justice",
  ],
};

/** Every sector this module can propose, with the category each belongs to. */
export const SECTOR_CATEGORY_BY_PRESET: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SECTOR_TAXONOMY).flatMap(([category, presets]) =>
    presets.map((preset) => [preset, category]),
  ),
);

/**
 * Below this, there is not enough of the site's own words to read a sector
 * from. A one-line "Welcome to our website" carries no evidence, and matching a
 * single term in it would propose a sector on the strength of one word.
 */
export const MIN_SECTOR_EVIDENCE_LENGTH = 40;

/** How much of a page's text is considered. Descriptions run to a few hundred. */
const MAX_TEXT_CONSIDERED = 5_000;

export type SectorMatch = {
  /** A preset from SECTOR_TAXONOMY — never free text. */
  sector: string;
  /** The taxonomy category it sits under, for showing the admin where it lands. */
  category: string;
  /** The terms that earned it, in the order they are declared. Shown, not stored. */
  matchedTerms: string[];
};

export type SectorProposal =
  | (SectorMatch & {
      status: "proposed";
      /** Where the words came from, after redirects. */
      sourceUrl: string;
      hostname: string;
      /** The site's own sentence the match was read from. Shown as the evidence. */
      evidence: string;
    })
  | { status: "skipped"; reason: string };

export type SectorLookupDependencies = {
  fetchPage: (value: string | null | undefined) => Promise<PageFetchResult>;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A term matches from a word boundary and may run on into its own suffixes:
 * "homeless" matches "homelessness", "sport" matches "sporting". It does NOT
 * match inside a word, so "arts" never fires on "parts".
 */
function textContainsTerm(text: string, term: string): boolean {
  return new RegExp(`\\b${escapeRegExp(term)}`, "i").test(text);
}

/**
 * The sector a piece of text points at, or null when it points at nothing or at
 * two things equally.
 *
 * Pure and dependency-free, so the whole judgement is testable without a network
 * — the fetch above it is the only part that needs the world.
 */
export function classifySectorFromText(text: string | null | undefined): SectorMatch | null {
  const haystack = (text ?? "").slice(0, MAX_TEXT_CONSIDERED);
  if (haystack.trim().length < MIN_SECTOR_EVIDENCE_LENGTH) return null;

  const scored: SectorMatch[] = [];
  for (const [sector, terms] of Object.entries(SECTOR_TERMS)) {
    const matchedTerms = terms.filter((term) => textContainsTerm(haystack, term));
    if (matchedTerms.length === 0) continue;
    scored.push({
      sector,
      category: SECTOR_CATEGORY_BY_PRESET[sector] ?? "",
      matchedTerms,
    });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length);
  const [best, runnerUp] = scored;

  // A tie is not a near miss to be broken by declaration order — it is the
  // case this module exists to refuse. A wrong sector moves a client's
  // priority silently; a missing one scores an explicit neutral.
  if (runnerUp && runnerUp.matchedTerms.length === best.matchedTerms.length) return null;

  return best;
}

/**
 * Fetches one page through F037's shared, robots-aware, SSRF-safe transport and
 * proposes the sector its own words point at.
 *
 * Never throws — an unreachable, blocked or uninformative site is an ordinary
 * outcome the caller shows to a human, same contract as proposeMissionFromWebsite.
 */
export async function proposeSectorFromWebsite(
  url: string | null | undefined,
  legalName: string | null,
  deps: SectorLookupDependencies,
): Promise<SectorProposal> {
  const result = await deps.fetchPage(url);
  if (result.status !== "fetched") {
    // page-transport's failure messages are already written to be read by a
    // person (F037 AC11: no status codes, no host errors), so they pass through.
    return { status: "skipped", reason: result.message };
  }

  const extracted = extractOrganisation(result.html, result.finalUrl);
  const description = extracted.missionStatement?.trim() ?? "";

  if (!description) {
    return {
      status: "skipped",
      reason:
        "That page does not describe what this client does, so there is nothing to read a sector from. Pick one above instead.",
    };
  }

  // The organisation's own name is evidence too — "Sheffield Riverside
  // Woodland Trust" says more than most meta descriptions — but it is joined
  // to the description rather than weighted, so the match is always something
  // a reader can see in the text quoted back to them.
  const match = classifySectorFromText(`${legalName ?? ""} ${description}`);

  if (!match) {
    return {
      status: "skipped",
      reason:
        "What that page says about itself does not point clearly at one sector. Pick one above instead.",
    };
  }

  let hostname: string;
  try {
    hostname = new URL(result.finalUrl).hostname.replace(/^www\./, "");
  } catch {
    return { status: "skipped", reason: "That website address could not be read." };
  }

  return {
    status: "proposed",
    sector: match.sector,
    category: match.category,
    matchedTerms: match.matchedTerms,
    sourceUrl: result.finalUrl,
    hostname,
    evidence: description,
  };
}

/** Production wrapper; the decision logic stays injectable and unit-testable above. */
export function createDefaultSectorLookupDependencies(): SectorLookupDependencies {
  return { fetchPage: fetchImportPage };
}
