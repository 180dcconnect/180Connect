// F216: Search by Similarity (#211) — pure calculation logic.
//
// AC2 is the whole design: similarity must be "calculated using the same or
// related feature dimensions as the scoring engine (F088) and outcome data
// (F143/F144), not an arbitrary or opaque similarity metric". So this module
// invents no metric. It re-uses F088's five scorers verbatim, each through its
// own public function, and measures similarity as AGREEMENT on the states
// those scorers already define:
//
//   sector     scoreBySector (F089)   — same taxonomy category
//   geography  scoreByGeography (F090)— same priority-area status
//   size       scoreByOrganisationSize (F091) — same income band
//   partnershipHistory scoreByPartnershipHistory (F092) — both have matched grants
//   pipeline   the F143/F150 outcome reading scoreByPreviousContact ranks —
//              same terminal-ish status (converted / future_potential)
//
// Agreement is state equality, never a factor threshold: F089 gives every
// category a DISTINCT factor, but "similar" must mean "the same state", not
// "a nearby number" — a Health reference and an Education candidate score
// 0.7 vs 0.65, close enough to trip any numeric tolerance, yet they are not
// similar on sector and this module says so. A CAM can open any similar
// client and read the same factor values on its score-breakdown card (F095),
// which is what makes the metric non-opaque by construction.
//
// A dimension the REFERENCE has no signal for is SKIPPED for every candidate —
// comparing against a neutral would manufacture agreement the reference never
// earned ("both have unknown sector" is not a similarity). A dimension the
// CANDIDATE lacks simply fails to agree.
//
// AC1 — "past successful client" is read through the pipeline: a reference
// qualifies when its outreach_status is `converted` (F150's terminal success)
// or `future_potential` (F151 — not a fit now, worth revisiting; the
// pipeline's other affirmative outcome). `isSimilarityReference` is the one
// definition; the detail page offers the action only when it passes.
//
// AC3 — the explicit insufficient-data state. Two gates, both surfacing as
// status: "insufficient_data" with a reason the page renders honestly:
//   reference_undescribed — the reference carries fewer than
//     MIN_REFERENCE_KNOWN_DIMENSIONS known dimensions, so "similar" would
//     mean "same as me in one arbitrary respect";
//   too_few_matches — fewer than MIN_SIMILAR_CLIENTS candidates agree on
//     anything, and a list of one or two would read as precision the data
//     cannot back.
//
// Candidates come from the caller's already-visible list (the client-list
// page's post-suppression set). The module re-checks the suppression flag
// defensively — it is cheap, and AC3's honest-data promise covers it — and
// never returns the reference itself.

import {
  BRANCH_PRIORITY_REGIONS,
  latestTotalIncome,
} from "./scoring/score-client.ts";
import { scoreBySector } from "./scoring/score-by-sector.ts";
import { scoreByGeography } from "./scoring/score-by-geography.ts";
import { scoreByOrganisationSize } from "./scoring/score-by-organisation-size.ts";
import { scoreByPartnershipHistory } from "./scoring/score-by-partnership-history.ts";
import { INCOME_BAND_SHORT_NAMES, type IncomeBand } from "./income-band.ts";

/** Statuses an outcome-rich reference may carry (AC1) — F150 and F151. */
export const SIMILAR_REFERENCE_STATUSES: readonly string[] = ["converted", "future_potential"];

export function isSimilarityReference(status: string | null | undefined): boolean {
  return status === "converted" || status === "future_potential";
}

/** AC3 gate one: the reference needs at least this many known dimensions. */
export const MIN_REFERENCE_KNOWN_DIMENSIONS = 2;

/** AC3 gate two: fewer agreeing candidates than this is noise, not a shortlist. */
export const MIN_SIMILAR_CLIENTS = 3;

/** Default cap on returned matches; the page renders what fits a card. */
export const MAX_SIMILAR_MATCHES = 25;

/**
 * The row shape this module needs. VisibleClient (client list) satisfies it
 * structurally — same convention as ScoreableOrganisation, so neither side
 * imports the other. `matched_grant_count` is the count of embedded grant rows
 * (F092's input); `priorityScore` is the persisted F088 base score.
 */
export type SimilarityClient = {
  id: string;
  legal_name: string;
  city?: string | null;
  sector?: string | null;
  total_income?: number | null;
  financial_periods?: { total_income?: number | null; period_end?: string | null }[] | null;
  outreach_status: string;
  matched_grant_count?: number | null;
  priorityScore?: number | null;
  /** The list's suppression state; pending/active rows are excluded. */
  suppressionPending?: boolean;
};

export type SharedDimension = {
  key: DimensionKey;
  label: string;
  description: string;
};

export type SimilarMatch<T extends SimilarityClient> = {
  client: T;
  /** Agreements over the reference's known dimensions, 0-1. */
  similarity: number;
  sharedDimensions: SharedDimension[];
};

export type SimilarClientsResult<T extends SimilarityClient> = {
  status: "ok" | "insufficient_data";
  /** Why the gate tripped — only meaningful when status is insufficient_data. */
  reason: "reference_undescribed" | "too_few_matches" | null;
  reference: {
    id: string;
    name: string;
    knownDimensions: { key: DimensionKey; label: string }[];
  };
  matches: SimilarMatch<T>[];
};

type DimensionKey = "sector" | "geography" | "size" | "partnershipHistory" | "pipeline";

type DimensionDefinition<T> = {
  key: DimensionKey;
  label: string;
  /** The reference's comparable state, or null when the dimension is unknown
   * for it (skipped for every candidate). */
  referenceState: (client: SimilarityClient, priorityRegions: readonly string[]) => T | null;
  /** The candidate's comparable state (null = no signal; cannot agree). */
  candidateState: (client: SimilarityClient, priorityRegions: readonly string[]) => T | null;
  describe: (referenceState: T) => string;
};

const incomeBandLabel = (band: IncomeBand): string =>
  INCOME_BAND_SHORT_NAMES[band] ?? band;

/** The named sector category, or null when the sector is missing/unmatched. */
function sectorCategory(client: SimilarityClient): string | null {
  return scoreBySector(client.sector ?? null).matchedCategory;
}

/**
 * The priority-area status, or null when geography carries no signal: no
 * location recorded (usedDefault), or no priority areas configured
 * (noPreferenceSet) — with nothing to be in or out of, "both outside" would
 * compare against a configuration the branch never made.
 */
function geographyState(
  client: SimilarityClient,
  priorityRegions: readonly string[],
): "priority" | "outside" | null {
  const result = scoreByGeography(client.city ?? null, priorityRegions);
  if (result.usedDefault || result.noPreferenceSet) return null;
  return result.matchedPriorityRegion ? "priority" : "outside";
}

/** The size band, or null when income is unknown (F091's used-default). */
function sizeBand(client: SimilarityClient): IncomeBand | null {
  const result = scoreByOrganisationSize(latestTotalIncome(client));
  return result.usedDefault ? null : result.band;
}

function hasMatchedGrants(client: SimilarityClient): boolean {
  return scoreByPartnershipHistory(client.matched_grant_count).hasMatchedHistory;
}

/**
 * The pipeline outcome state — only F150/F151 count. "Sent", "responded",
 * "no response" say nothing about what WORKED, so a reference in any other
 * status has this dimension unknown, and a candidate in another status
 * simply does not agree (a converted reference is not similar-by-outcome to
 * a no_response prospect; that is the honest reading of outcome data).
 */
function pipelineState(client: SimilarityClient): string | null {
  return isSimilarityReference(client.outreach_status) ? client.outreach_status : null;
}

/**
 * One definition per dimension: the F088/F143 states, how to read them off a
 * row, and the honest sentence each agreement produces. Declaration order is
 * also display order on the match card.
 */
const DIMENSIONS: readonly DimensionDefinition<string | boolean>[] = [
  {
    key: "sector",
    label: "Sector",
    referenceState: (client) => sectorCategory(client),
    candidateState: (client) => sectorCategory(client),
    describe: (category) => `both work in ${category}`,
  },
  {
    key: "geography",
    label: "Location",
    referenceState: geographyState,
    candidateState: geographyState,
    describe: (state) =>
      state === "priority"
        ? "both are in one of the branch's priority areas"
        : "both are outside the priority areas",
  },
  {
    key: "size",
    label: "Size",
    referenceState: (client): string | null => {
      const band = sizeBand(client);
      return band ? incomeBandLabel(band) : null;
    },
    candidateState: (client): string | null => {
      const band = sizeBand(client);
      return band ? incomeBandLabel(band) : null;
    },
    describe: (label) => `both sit in the ${label} income band`,
  },
  {
    key: "partnershipHistory",
    label: "Partnership history",
    referenceState: (client) => (hasMatchedGrants(client) ? true : null),
    candidateState: (client) => (hasMatchedGrants(client) ? true : null),
    describe: () => "both have matched grant history (360Giving)",
  },
  {
    key: "pipeline",
    label: "Outcome",
    referenceState: (client) => pipelineState(client),
    candidateState: (client) => pipelineState(client),
    describe: (status) =>
      status === "converted"
        ? "both converted"
        : "both previously marked future potential",
  },
];

/**
 * AC1+AC2: the reference's similar clients among `candidates`.
 *
 * `candidates` should be the visible list the caller already holds (the
 * client-list page's post-suppression set, grant rows already embedded so the
 * caller can count them into `matched_grant_count`). Pure: the same rows and
 * reference always produce the same shortlist, so tests and the two UI
 * entry points cannot disagree.
 */
export function findSimilarClients<T extends SimilarityClient>(
  reference: SimilarityClient,
  candidates: readonly T[],
  options: {
    priorityRegions?: readonly string[];
    limit?: number;
  } = {},
): SimilarClientsResult<T> {
  const priorityRegions = options.priorityRegions ?? BRANCH_PRIORITY_REGIONS;
  const limit = options.limit ?? MAX_SIMILAR_MATCHES;

  const referenceState = new Map<DimensionKey, string | boolean>();
  for (const dimension of DIMENSIONS) {
    const state = dimension.referenceState(reference, priorityRegions);
    if (state !== null) referenceState.set(dimension.key, state);
  }
  const knownDimensions = DIMENSIONS.filter((d) => referenceState.has(d.key)).map((d) => ({
    key: d.key,
    label: d.label,
  }));
  const undescribed = {
    status: "insufficient_data" as const,
    reason: "reference_undescribed" as const,
    reference: { id: reference.id, name: reference.legal_name, knownDimensions },
    matches: [] as SimilarMatch<T>[],
  };

  if (knownDimensions.length < MIN_REFERENCE_KNOWN_DIMENSIONS) return undescribed;

  const matches: SimilarMatch<T>[] = [];
  for (const candidate of candidates) {
    if (candidate.id === reference.id) continue;
    if (candidate.suppressionPending) continue;

    const shared: SharedDimension[] = [];
    for (const dimension of DIMENSIONS) {
      const wanted = referenceState.get(dimension.key);
      if (wanted === undefined) continue;
      const actual = dimension.candidateState(candidate, priorityRegions);
      if (actual === null || actual !== wanted) continue;
      shared.push({
        key: dimension.key,
        label: dimension.label,
        description: dimension.describe(wanted),
      });
    }
    if (shared.length === 0) continue;

    matches.push({
      client: candidate,
      similarity: shared.length / knownDimensions.length,
      sharedDimensions: shared,
    });
  }

  // AC3: a shortlist too thin to trust is a state, not a shorter list.
  if (matches.length < MIN_SIMILAR_CLIENTS) {
    return {
      status: "insufficient_data",
      reason: "too_few_matches",
      reference: { id: reference.id, name: reference.legal_name, knownDimensions },
      matches: [],
    };
  }

  matches.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    const scoreA = a.client.priorityScore ?? 0;
    const scoreB = b.client.priorityScore ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.client.legal_name.localeCompare(b.client.legal_name);
  });

  return {
    status: "ok",
    reason: null,
    reference: { id: reference.id, name: reference.legal_name, knownDimensions },
    matches: matches.slice(0, limit),
  };
}

/** "75% — both work in Health & Wellbeing, both sit in the Medium income band" */
export function describeSimilarity(match: SimilarMatch<SimilarityClient>): string {
  const percent = Math.round(match.similarity * 100);
  return `${percent}% — ${match.sharedDimensions.map((d) => d.description).join(", ")}`;
}

/** The reason a result was judged too thin to show (AC3). */
type InsufficientReason = "reference_undescribed" | "too_few_matches";

/**
 * The insufficient-data result without its client generic — what callers and
 * tests hand describeInsufficientData when the generic gets in the way of
 * narrowing.
 */
export type SimilarInsufficientData = {
  status: "insufficient_data";
  reason: InsufficientReason;
  reference: { id: string; name: string; knownDimensions: { key: DimensionKey; label: string }[] };
  matches: readonly unknown[];
};

/**
 * AC3's user-facing copy, kept next to the gates that trigger it so the
 * wording cannot drift from the condition. `reason` picks the sentence; the
 * known dimensions are named because "what it could read" is the honest
 * answer to "why not".
 */
export function describeInsufficientData(result: SimilarInsufficientData): string {
  const known = result.reference.knownDimensions.map((d) => d.label.toLowerCase());
  const knownSentence =
    known.length > 0
      ? `We can read ${known.join(" and ")} for it, but `
      : "";
  if (result.reason === "reference_undescribed") {
    return `${knownSentence}this client needs at least ${MIN_REFERENCE_KNOWN_DIMENSIONS} of sector, location, size, grant history or a recorded outcome before we can find similar ones.`;
  }
  return `Not enough data to find similar clients yet — too few clients share this one's ${known.join(" and ") || "recorded details"}.`;
}
