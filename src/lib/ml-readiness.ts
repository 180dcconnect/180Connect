/**
 * F099 — Minimum Outcome Threshold Tracking.
 *
 * Where we are today: F098's `training_examples` view already holds one row
 * per scored attempt with `outcome_label` (null until an outcome exists).
 * This module turns that count into the admin-facing readiness signal —
 * "N of M minimum outcomes" — without introducing any new table or writer.
 * The count lives in the view (training_examples where outcome_label is not
 * null); the threshold lives here as a named constant so the same number
 * drives the page, its tests, and the description the PM signs off on.
 *
 * Pending confirmation from the PM is modelled the same way
 * PRIORITY_BAND_THRESHOLDS chose: a constant with an explicit caveat. When
 * the agreed minimum moves, change one value and the progress language moves
 * with it.
 */

/** How many labelled outcomes the team has agreed make ML training realistic. */
export const MINIMUM_OUTCOME_THRESHOLD = 50;

export type Readiness = {
  labelledCount: number;
  threshold: number;
  remaining: number;
  met: boolean;
  /** Whole percent toward the threshold, capped at 100 for the progress bar. */
  percent: number;
  /** Human line the page renders verbatim. */
  label: string;
};

export function outcomeReadiness(labelledCount: number): Readiness {
  const count = Math.max(0, Math.floor(labelledCount));
  const threshold = MINIMUM_OUTCOME_THRESHOLD;
  const remaining = Math.max(0, threshold - count);
  const met = count >= threshold;
  const percent = Math.min(100, Math.round((count / threshold) * 100));
  const label = `${count} of ${threshold} minimum outcomes${met ? " — threshold met" : ""}`;
  return { labelledCount: count, threshold, remaining, met, percent, label };
}
