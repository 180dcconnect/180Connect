// F091: Score by Organisation Size — pure calculation logic.
//
// WHERE THE INPUT COMES FROM — FINANCIAL_PERIODS, not ORGANISATIONS:
//
//   income → FINANCIAL_PERIODS.total_income (GBP annual income)
//
// ORGANISATIONS has no size/income column by design: filed accounts live on
// the org-child FINANCIAL_PERIODS table
// (supabase/migrations/20260804180000_create_org_children.sql), whose
// income_band column is computed from total_income at ingestion. So the
// scoring input already exists in the schema; the remaining integration
// question is WHICH financial period feeds the score (presumably the
// latest available) — that is future wiring work, not a missing field.
// Like the other scoring-parameter tickets, this function takes the income
// value directly so whatever reads that column can call it unchanged.
//
// BANDS — the canonical four, not a parallel vocabulary:
//
// Classification delegates to deriveIncomeBand (src/lib/income-band.ts),
// the same derivation the outreach-preferences UI and visible-clients
// queue ordering already use, so output matches FINANCIAL_PERIODS
// .income_band and the CAM OUTREACH_PREFERENCES.preferred_income_bands
// values by construction. There is no small/medium/large scale here to
// reconcile with them later.
//
// AC3: the size parameter's weight must be reviewable independently of the
// other scoring parameters (F096). This function only ever produces its own
// standalone 0-1 score; F088's calculatePriorityScore on dev combines the
// four per-factor scores with the confirmed EQUAL_WEIGHTS, and its `size`
// factor is exactly where this result plugs in — wiring it up is future
// integration work, deliberately not attempted here.
//
// OUT OF SCOPE — personal preference matching:
//
// The issue's "personal preference impact" testing note is served by F198
// (Size Preference), which matches clients against OUTREACH_PREFERENCES
// .preferred_income_bands. This function deliberately takes no preference
// input; it always produces the same score for the same income figure.

import { deriveIncomeBand, type IncomeBand } from "../income-band.ts";

export type SizeScoreResult = {
  score: number;
  band: IncomeBand | null;
  usedDefault: boolean;
};

/**
 * TODO: placeholder per-band scores, not a real decision — while the band
 * BOUNDARIES are settled by the public.income_band enum, the per-band
 * scores are not (the ticket's "Blocked By" note flags exactly this).
 * Larger organisations currently score higher here — also just a guess
 * (a charity's "priority" isn't necessarily correlated with its size in
 * either direction; the team may want the opposite, or a different curve
 * entirely).
 */
const BAND_SCORES: Record<IncomeBand, number> = {
  under_10k: 0.2,
  "10k_100k": 0.4,
  "100k_1m": 0.6,
  over_1m: 0.9,
};

/**
 * AC2: explicit default for missing size/income data, not exclusion from
 * scoring — a client with no income figure still gets scored, just at a
 * neutral midpoint rather than being dropped from the queue entirely.
 */
const DEFAULT_FOR_MISSING_SIZE = 0.5;

export function scoreByOrganisationSize(
  income: number | null | undefined,
): SizeScoreResult {
  if (
    income === null ||
    income === undefined ||
    Number.isNaN(income) ||
    // A negative income figure is bad input data, not a valid band —
    // treated the same as missing rather than producing a nonsensical
    // classification.
    income < 0
  ) {
    return { score: DEFAULT_FOR_MISSING_SIZE, band: null, usedDefault: true };
  }

  const band = deriveIncomeBand(income);

  // Unreachable for the guarded inputs above, but kept fail-closed so a
  // future deriveIncomeBand change degrades to the AC2 default instead of
  // crashing the score.
  if (band === null) {
    return { score: DEFAULT_FOR_MISSING_SIZE, band: null, usedDefault: true };
  }

  return { score: BAND_SCORES[band], band, usedDefault: false };
}
