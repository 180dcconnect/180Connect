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
  const label = `${count} of ${threshold} client outcomes${met ? " — target met" : ""}`;
  return { labelledCount: count, threshold, remaining, met, percent, label };
}

// ---------------------------------------------------------------------------
// The breakdown behind the count
// ---------------------------------------------------------------------------

/**
 * A labelled outcome as the view publishes it — the four columns the breakdown
 * reads, nothing else. Deliberately not the whole view: the groupings below are
 * the only thing this module is allowed to know about a row.
 */
export type OutcomeRow = {
  outcome_label: string;
  organisation_id: string;
  /** The client's sector as it stands now, not at send time (see the view's header caveat). */
  organisation_sector: string | null;
  outcome_recorded_at: string | null;
};

/** The dimensions the card can be switched between. */
export type OutcomeGrouping = "type" | "client" | "sector" | "month";

/** One bucket: what it is, in the reader's words, and how many outcomes it holds. */
export type OutcomeGroup = { label: string; count: number };

/**
 * The count per bucket for one dimension, biggest first.
 *
 * `clientNames` is passed in rather than looked up: the caller has already had to
 * read the clients for the names, and a bucket labelled with a uuid would be
 * exactly the internal name the screen must never show.
 *
 * Buckets with nothing to group by are kept, not dropped — "Client not
 * recorded" is a finding about the data, and hiding it would make the rows add
 * up to less than the count above them.
 */
export function groupOutcomes(
  rows: readonly OutcomeRow[],
  grouping: OutcomeGrouping,
  clientNames: ReadonlyMap<string, string> = new Map(),
): OutcomeGroup[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const bucket = bucketLabel(row, grouping, clientNames);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The words the reader sees for one row's bucket in one dimension. */
function bucketLabel(
  row: OutcomeRow,
  grouping: OutcomeGrouping,
  clientNames: ReadonlyMap<string, string>,
): string {
  if (grouping === "type") return titleCase(row.outcome_label);
  if (grouping === "client") return clientNames.get(row.organisation_id) ?? "Client not on file";
  if (grouping === "sector") return row.organisation_sector?.trim() || "Sector not recorded";
  return monthLabel(row.outcome_recorded_at);
}

/** `soft_no` reads as "Soft no" — the label is stored as a token, shown as words. */
function titleCase(value: string): string {
  const words = value.replaceAll("_", " ").trim();
  if (!words) return "Outcome not recorded";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The month an outcome was recorded, e.g. "September 2026". UTC on purpose:
 * the same outcome must not land in a different month depending on who is
 * reading it, and the timestamp it comes from is a UTC instant.
 */
function monthLabel(iso: string | null): string {
  if (!iso) return "Month not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Month not recorded";
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
