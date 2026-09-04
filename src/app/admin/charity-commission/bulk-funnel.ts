/**
 * Turns a bulk import run's `run_stats` into the funnel the page draws.
 *
 * The bulk adapter streams the whole register and keeps a small fraction of it.
 * Which fraction, and why, is the only thing an admin on this page actually
 * needs: it answers "why is charity X not in the client list" without reading
 * TypeScript, and it makes a filter that was widened by accident visible as a
 * step change between two runs rather than as a client list nobody can explain.
 *
 * Pure and node-testable, same split as `run-format.ts` on the Import Status
 * page — the arithmetic that decides what a reader sees is worth asserting
 * directly rather than only through a rendered page.
 */

/** The stages, in the order the adapter's gates apply. */
const STAGES = [
  {
    key: "charitiesScanned",
    label: "On the register",
    detail: "Every charity in the day's bulk extract.",
  },
  {
    key: "registered",
    label: "Registered, not a subsidiary",
    detail:
      "Removed charities dropped, and linked subsidiary rows that share a parent's number.",
  },
  {
    key: "passedIncome",
    label: "Large enough",
    detail: "At or above the income floor — below it there is no capacity to host a project.",
  },
  {
    key: "passedSector",
    label: "In an accepted sector",
    detail: "Classified by the regulator into one of the sectors the branch works with.",
  },
  {
    key: "accepted",
    label: "Local to the branch",
    detail: "Operating in a priority local authority, or with a correspondence address in one.",
  },
] as const;

export type FunnelStage = {
  key: string;
  label: string;
  detail: string;
  value: number;
  /** Width as a percentage of the first stage, for the bar. Always 0–100. */
  share: number;
  /** How many the previous gate removed. Null on the first stage. */
  dropped: number | null;
};

/**
 * Whatever `ingestion_runs.run_stats` holds, which is jsonb and therefore
 * anything at all — a run recorded before the column existed reads as null, and
 * a source that reports no funnel writes null too.
 */
export type RunStats = Record<string, unknown> | null | undefined;

function count(stats: Record<string, unknown>, key: string): number | null {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The funnel, or null when this run reported none.
 *
 * Null rather than a funnel of zeroes: "this run recorded no stats" and "this
 * run scanned nothing" are different facts, and the page says something
 * different about each. A run missing any stage is treated as reporting none —
 * a half-drawn funnel invites the reader to infer a drop that never happened.
 */
export function bulkFunnel(stats: RunStats): FunnelStage[] | null {
  if (!stats || typeof stats !== "object") return null;

  const values = STAGES.map((stage) => count(stats as Record<string, unknown>, stage.key));
  if (values.some((value) => value === null)) return null;

  const counts = values as number[];
  const total = counts[0];

  return STAGES.map((stage, index) => ({
    key: stage.key,
    label: stage.label,
    detail: stage.detail,
    value: counts[index],
    // A run that scanned nothing has no meaningful share; 0 keeps every bar
    // empty rather than dividing by zero into NaN and rendering an empty page.
    share: total > 0 ? Math.min(100, (counts[index] / total) * 100) : 0,
    dropped: index === 0 ? null : counts[index - 1] - counts[index],
  }));
}

/**
 * The discovery job's much smaller equivalent: how many charities registered
 * nationally in the window, and how many of those were near enough to import.
 */
export type DiscoveryReach = { registeredNationally: number; local: number };

export function discoveryReach(stats: RunStats): DiscoveryReach | null {
  if (!stats || typeof stats !== "object") return null;
  const record = stats as Record<string, unknown>;
  const registeredNationally = count(record, "registeredNationally");
  const local = count(record, "local");
  if (registeredNationally === null || local === null) return null;
  return { registeredNationally, local };
}

/** "185,574" — one place, so the funnel and the prose above it never disagree. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-GB");
}

/** One `ingestion_runs` row as this page reads it. */
export type CharityCommissionRun = {
  id: string;
  api_source: string;
  started_at: string;
  job_status: string;
  records_fetched: number;
  records_inserted: number;
  records_skipped: number;
  records_failed: number;
  run_stats: RunStats;
};

/** Which pipeline a run came from, in the words this page uses for them. */
export const PIPELINE_LABEL: Record<string, string> = {
  // Retired 2026-09-03 — kept so historical runs still read as something rather
  // than as a raw source token.
  charity_commission: "API discovery (retired)",
  charity_commission_bulk: "Register import",
};

/**
 * What one run did, in a sentence.
 *
 * The old table printed Fetched / Written / Skipped / Failed as four columns and
 * left the reader to work out which mattered — usually one of them, with the
 * other three at zero. This says the outcome and carries only the counts that
 * are not zero.
 */
export function summariseRun(run: CharityCommissionRun): string {
  if (run.job_status === "running") return "Running now.";
  if (run.job_status === "failed") return "Failed — nothing was imported.";

  const parts: string[] = [];
  if (run.records_inserted > 0) parts.push(`${formatCount(run.records_inserted)} written`);
  if (run.records_skipped > 0) parts.push(`${formatCount(run.records_skipped)} already held`);
  if (run.records_failed > 0) parts.push(`${formatCount(run.records_failed)} unusable`);

  // A run that found nothing is a normal weekly outcome, not a problem, and
  // saying so plainly stops it being read as one.
  if (parts.length === 0) return "Nothing new to import.";

  const sentence = `${parts.join(", ")}.`;
  const reach = discoveryReach(run.run_stats);
  return reach
    ? `${sentence} ${formatCount(reach.registeredNationally)} registered nationally in the window, ` +
        `${formatCount(reach.local)} local.`
    : sentence;
}
