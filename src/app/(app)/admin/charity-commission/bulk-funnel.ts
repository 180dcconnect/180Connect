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

// Relative with an explicit extension, like the status helpers below: this
// module is run directly by node --test, which resolves neither the tsconfig
// path alias nor an extensionless specifier.
import { describeImportFailure } from "../../../../lib/import-failure-reason.ts";
import { registerImportBreakdownFrom } from "../import-status/run-format.ts";
import {
  isStalledRun,
  stalledRunSummary,
} from "../import-status/status-helpers.ts";

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
  triggered_by?: string | null;
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
export function summariseRun(run: CharityCommissionRun, now: Date = new Date()): string {
  if (run.job_status === "running") {
    return isStalledRun(run.started_at, now)
      ? stalledRunSummary(run.started_at, now)
      : "Running now.";
  }
  if (run.job_status === "failed") return "Failed — nothing was imported.";

  // `records_inserted` counts register rows staged, not clients. When the run
  // recorded what promotion did with them, that is the half a reader came for
  // — and a run that staged hundreds and saved none of them is a failure, not
  // a big number with a footnote.
  const register = registerImportBreakdownFrom(run.api_source, run.run_stats);
  if (register && register.failedToSave > 0) {
    const count = formatCount(register.failedToSave);
    const noun = register.failedToSave === 1 ? "record" : "records";
    const head =
      register.clientsAdded === null || register.clientsAdded === 0
        ? `Nothing was added to the client list — all ${count} ${noun} were refused`
        : `${formatCount(register.clientsAdded)} added to the client list, ${count} ${noun} refused`;
    const reason = describeImportFailure(register.failureReasons[0] ?? null);
    return reason ? `${head}. ${reason.summary}.` : `${head}.`;
  }

  const parts: string[] = [];
  if (register && register.clientsAdded !== null) {
    if (register.clientsAdded > 0) parts.push(`${formatCount(register.clientsAdded)} added to the client list`);
    if (register.duplicates > 0)
      parts.push(`${formatCount(register.duplicates)} matched a client already on the list`);
    if (register.needsReview > 0) parts.push(`${formatCount(register.needsReview)} flagged for review`);
    if (register.didNotMeet > 0)
      parts.push(`${formatCount(register.didNotMeet)} did not meet the client criteria`);
  } else if (run.records_inserted > 0) {
    // No promotion breakdown on this row, so all that is honestly known is how
    // many records the run took from the register. "Written" is the pipeline's
    // word for it, not the reader's.
    parts.push(`${formatCount(run.records_inserted)} taken from the source`);
  }
  if (run.records_skipped > 0) parts.push(`${formatCount(run.records_skipped)} already on the list`);
  if (run.records_failed > 0) parts.push(`${formatCount(run.records_failed)} could not be saved`);

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
