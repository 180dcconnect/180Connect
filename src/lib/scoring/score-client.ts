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
// FACTOR COVERAGE — what feeds each of the four factors today:
//
//   sector          NEUTRAL (F089_UNBUILT_SECTOR_FACTOR below). There is no
//                   sector scorer yet — ORGANISATIONS.sector only gained a
//                   column in 20260824100000, and no ticket defines how a raw
//                   sector becomes a 0-1 signal. Neutral until F089 lands.
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
//   previousContact PLACEHOLDER mapping from outreach_status, marked as such
//                   below. F093 (the ticket that would define "previous
//                   contact") does not exist, and there is no contact-history
//                   table yet; the pipeline status is the only signal in the
//                   database today that says whether we have ever engaged this
//                   client. Values are guesses pending F093, in the same
//                   spirit as the marked placeholders in score-by-geography
//                   and score-by-partnership-history — swap them in one place
//                   when the real definition arrives.
//
// BANDS — high >= 0.70, medium >= 0.40, low < 0.40. Thresholds proposed with
// F058/F059, pending team confirmation; they live here AND in MODEL_VERSIONS'
// SCOUT v1 config row (migration 20260831200000), so change both together —
// the config row is the historical record of what produced existing scores.

import {
  calculatePriorityScore,
  type PriorityFactors,
} from "./calculate-priority-score.ts";
import { scoreByGeography } from "./score-by-geography.ts";
import { scoreByOrganisationSize } from "./score-by-organisation-size.ts";

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

/** Neutral 0-1 factor for a scorer that has not been built yet (see header). */
const UNBUILT_FACTOR_NEUTRAL = 0.5;

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
 * PLACEHOLDER values pending F093 — warmer statuses read as more prior
 * engagement, `not_contacted` sits at neutral (never engaged is unknown, not
 * bad), and closed-lost outcomes sit low. Not a decision; see header.
 */
const PREVIOUS_CONTACT_BY_STATUS: Record<string, number> = {
  converted: 1.0,
  responded: 0.9,
  follow_up_sent: 0.7,
  initial_outreach_sent: 0.6,
  future_potential: 0.6,
  loss_due_timing: 0.4,
  soft_no: 0.3,
  no_response: 0.2,
  hard_no: 0.1,
};

function previousContactFactor(outreachStatus: string): number {
  return PREVIOUS_CONTACT_BY_STATUS[outreachStatus] ?? UNBUILT_FACTOR_NEUTRAL;
}

/**
 * The four normalised factors for one organisation. Exported because the
 * backfill reports which factors were carrying real signal versus standing at
 * neutral — the honest way to show a stakeholder why two clients score alike.
 */
export function priorityFactorsFor(
  org: ScoreableOrganisation,
  priorityRegions: readonly string[] = [],
): PriorityFactors {
  return {
    sector: UNBUILT_FACTOR_NEUTRAL,
    geography: scoreByGeography(org.city, priorityRegions).score,
    size: scoreByOrganisationSize(latestTotalIncome(org)).score,
    previousContact: previousContactFactor(org.outreach_status),
  };
}

/**
 * F088's score for one organisation, plus the band LATEST_SCORES stores beside
 * it. Never throws on missing data — every factor degrades to its documented
 * default instead, matching the scorers' own AC2-style "explicit default, not
 * exclusion" behaviour.
 */
export function computePriorityScore(
  org: ScoreableOrganisation,
  priorityRegions: readonly string[] = [],
): { score: number; band: PriorityBand } {
  const score = calculatePriorityScore(priorityFactorsFor(org, priorityRegions));
  return { score, band: bandForScore(score) };
}
