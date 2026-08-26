// F058/F059: turns an organisation row into its persisted priority score.
//
// This is the adapter between the data side of the house (ORGANISATIONS +
// FINANCIAL_PERIODS rows, as fetched by the client list or the ingestion
// pipeline) and F088's calculatePriorityScore, which deliberately takes
// already-normalised 0-1 factors rather than raw fields. Everything here is
// pure: the same org data always produces the same score, which is what lets
// the rescore hooks (ingestion promote, manual-entry approval,
// scripts/backfill-priority-scores.mts) and any future recomputation agree
// without coordination.
//
// FACTOR COVERAGE — what feeds each of the five factors today:
//
//   sector          scoreBySector(ORGANISATIONS.sector) — F089 wired in. The
//                   scorer ranks the standard six-category taxonomy (mirrored
//                   from the F197 settings presets) with a PM-approved v1
//                   ranking; free text that matches nothing and a missing
//                   sector both land on the explicit neutral 0.5, told apart
//                   by the scorer's flags rather than here.
//
//   partnershipHistory scoreByPartnershipHistory(matched grant count) — F096
//                   wired this fifth parameter into the base score: the scorer
//                   itself has existed since F092, and the grants table it
//                   counts is populated by ingestion. Callers that cannot count
//                   grants cheaply may omit the count; the scorer's documented
//                   no-history neutral applies.
//
//   geography       scoreByGeography(city, priorityRegions), with priority
//                   regions passed in by the caller. Today no caller has a
//                   branch-level region list (OUTREACH_PREFERENCES is per-CAM
//                   and must not leak into a shared base score), so this is
//                   neutral too. The parameter exists so the day a branch
//                   settings table lands, callers pass regions and every score
//                   sharpens without another code change here.
//
//   size            scoreByOrganisationSize(latest FINANCIAL_PERIODS
//                   .total_income) — real signal, the same derivation the
//                   income_band column itself uses.
//
//   previousContact  scoreByPreviousContact(outreach_status, last_contacted_at)
//                   — F093 replaced the old placeholder mapping with a real
//                   scorer (see that module for the confirmed ranking ideology:
//                   converted is gold, future_potential beats not_contacted,
//                   hard_no floors). The recency half of the signal comes from
//                   the organisation's most recent sent OUTREACH_MESSAGES row;
//                   callers that do not fetch it simply get the status-only
//                   score, never an error.
//
// BANDS — high >= 0.70, medium >= 0.40, low < 0.40. Thresholds proposed with
// F058/F059, pending team confirmation; they live here AND in MODEL_VERSIONS'
// SCOUT v1 config row (migration 20260831200000), so change both together —
// the config row is the historical record of what produced existing scores.

import {
  calculatePriorityScore,
  sanitizeWeights,
  type PriorityFactors,
  type ScoutWeights,
} from "./calculate-priority-score.ts";
import { scoreByGeography } from "./score-by-geography.ts";
import { scoreBySector } from "./score-by-sector.ts";
import { scoreByOrganisationSize } from "./score-by-organisation-size.ts";
import { scoreByPartnershipHistory } from "./score-by-partnership-history.ts";
import { scoreByPreviousContact } from "./score-by-previous-contact.ts";

/** The vocabulary LATEST_SCORES.priority_band stores (check-constrained). */
export type PriorityBand = "high" | "medium" | "low";

/**
 * Band cut-offs. A score of exactly 0.70 is high; exactly 0.40 is medium.
 * Pending team confirmation — see the migration header before changing.
 */
export const PRIORITY_BAND_THRESHOLDS = { high: 0.7, medium: 0.4 } as const;

export function bandForScore(score: number): PriorityBand {
  if (score >= PRIORITY_BAND_THRESHOLDS.high) return "high";
  if (score >= PRIORITY_BAND_THRESHOLDS.medium) return "medium";
  return "low";
}

/**
 * The slice of an organisation row this module needs. Structurally satisfied
 * by VisibleClient (client list / backfill) and by StandardOrganisation-shaped
 * rows (ingestion promote) alike, so neither side needs to know about the other.
 */
export type ScoreableOrganisation = {
  city?: string | null;
  sector?: string | null;
  total_income?: number | null;
  financial_periods?:
    | { total_income?: number | null; period_end?: string | null }[]
    | null;
  outreach_status: string;
  /**
   * F093: timestamp of the organisation's most recent *sent* outreach message
   * (OUTREACH_MESSAGES.sent_at). Optional — a caller without it gets the
   * status-only score; the recency decay simply does not apply.
   */
  last_contacted_at?: string | Date | null;
  /** Matched 360Giving grant count (F092). Omitted/null = no-history neutral. */
  matched_grant_count?: number | null;
};

/** Same resolution order as visible-clients.ts's resolveClientIncomeBand. */
export function latestTotalIncome(
  org: Pick<ScoreableOrganisation, "total_income" | "financial_periods">,
): number | null {
  if (org.financial_periods && org.financial_periods.length > 0) {
    const sorted = [...org.financial_periods].sort((a, b) => {
      const dateA = a.period_end ? new Date(a.period_end).getTime() : 0;
      const dateB = b.period_end ? new Date(b.period_end).getTime() : 0;
      return dateB - dateA;
    });
    // Newest period that actually carries an income figure — a filed-but-empty
    // latest period must not blind us to an older real one.
    const withIncome = sorted.find(
      (period) => period.total_income !== null && period.total_income !== undefined,
    );
    if (withIncome) return withIncome.total_income!;
  }
  return org.total_income ?? null;
}

/**
 * The five normalised factors for one organisation. Exported because the
 * backfill reports which factors were carrying real signal versus standing at
 * neutral — the honest way to show a stakeholder why two clients score alike.
 */
export function priorityFactorsFor(
  org: ScoreableOrganisation,
  priorityRegions: readonly string[] = [],
): PriorityFactors {
  return {
    // F089 — the sector scorer's own neutral covers both "no sector recorded"
    // and "free text matching nothing"; this layer just passes the value through.
    sector: scoreBySector(org.sector ?? null).score,
    geography: scoreByGeography(org.city, priorityRegions).score,
    size: scoreByOrganisationSize(latestTotalIncome(org)).score,
    partnershipHistory: scoreByPartnershipHistory(org.matched_grant_count).score,
    previousContact: scoreByPreviousContact(
      org.outreach_status,
      org.last_contacted_at,
    ).score,
  };
}

/**
 * F088's score for one organisation, plus the band LATEST_SCORES stores beside
 * it. Never throws on missing data — every factor degrades to its documented
 * default instead, matching the scorers' own AC2-style "explicit default, not
 * exclusion" behaviour.
 *
 * F096: weights come from the caller — the active SCOUT config the score will
 * be persisted under — not from a hard-coded table, so an interactive rescore
 * and a backfill run under the same weights simply by loading them once each.
 *
 * F095: the result carries the exact inputs behind the score — the five
 * normalised factors and the sanitized weights actually applied — so the
 * persistence layer can store a breakdown that provably reproduces
 * `priority_score` no matter how weights change afterwards.
 */
export type ComputedScore = {
  score: number;
  band: PriorityBand;
  factors: PriorityFactors;
  weights: ScoutWeights;
};

export function computePriorityScore(
  org: ScoreableOrganisation,
  priorityRegions: readonly string[] = [],
  weights?: unknown,
): ComputedScore {
  const effectiveWeights =
    weights === undefined ? sanitizeWeights(undefined) : sanitizeWeights(weights);
  const factors = priorityFactorsFor(org, priorityRegions);
  const score = calculatePriorityScore(factors, effectiveWeights);
  return { score, band: bandForScore(score), factors, weights: effectiveWeights };
}
