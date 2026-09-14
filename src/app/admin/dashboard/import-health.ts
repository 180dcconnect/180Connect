/**
 * `ingestion_runs` rows → the one reading an admin dashboard actually needs:
 * is the register still moving, and did anything fail.
 *
 * Pure, and tested directly by `node --test`, the same split as
 * `../import-status/run-format.ts` — whose sentences and tones this borrows
 * rather than restating, so the dashboard and the runs page can never describe
 * the same run two different ways.
 *
 * Only sources present in the window are reported. Inventing a fixed list of
 * sources would mean guessing each one's cadence to decide whether it is
 * "missing" or merely weekly, and a wrong guess here is an alarm nobody can act
 * on. What the window can state honestly is what last ran, when, and how it
 * went.
 */
import { formatRelativeTime } from "../../../lib/display-format.ts";
import { labelForStatus } from "../import-status/status-helpers.ts";
import {
  formatSource,
  summariseRun,
  toneForStatus,
  type IngestionRunRow,
  type RunTone,
} from "../import-status/run-format.ts";

/**
 * How recent a run has to be to count as "in the window". The register import
 * is a daily job, so a day is the smallest unit that can call a source quiet
 * without crying wolf at a job that simply has not ticked yet this morning.
 */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How many source rows the card carries before it says "+N more". */
export const MAX_SOURCES = 6;

export type SourceImportHealth = {
  /** Display label — "Charity Commission", never `charity_commission`. */
  source: string;
  raw: string;
  status: string;
  statusLabel: string;
  tone: RunTone;
  lastRunAt: string;
  /** "2 hours ago". */
  relative: string;
  /** One line from run-format: what that run did. */
  summary: string;
  /** Whether this source's newest run is inside the window. */
  recent: boolean;
};

export type ImportHealthVerdict = "healthy" | "problems" | "quiet";

export type ImportHealthSummary = {
  verdict: ImportHealthVerdict;
  /**
   * One row per source, capped at `MAX_SOURCES`, **attention first**: anything
   * that failed or finished incomplete, then anything quiet, then the rest by
   * recency. A stopped pipeline is the thing this card exists to show, and a
   * plain newest-first list would push it off the bottom exactly when other
   * sources are running.
   */
  sources: SourceImportHealth[];
  /** Sources seen in the window, before the cap. */
  sourceCount: number;
  /** Runs that failed or finished incomplete inside the window. */
  problemRuns: number;
  /** Runs of any outcome inside the window. */
  runsInWindow: number;
  /** The newest run overall, whichever source it belonged to. */
  latest: SourceImportHealth | null;
};

/** 0 needs a look now, 4 is fine. */
function attentionRank(row: SourceImportHealth): number {
  if (row.status === "failed") return 0;
  if (row.status === "partial") return 1;
  if (!row.recent) return 2;
  if (row.status === "running") return 3;
  return 4;
}

/**
 * `runs` must be **newest first** (the caller's query orders by `started_at`
 * descending). The first row seen for a source is therefore its latest run, and
 * no sort is needed to find it.
 */
export function summariseImportHealth(
  runs: readonly IngestionRunRow[],
  now: Date,
): ImportHealthSummary {
  const bySource = new Map<string, SourceImportHealth>();
  let problemRuns = 0;
  let runsInWindow = 0;

  for (const run of runs) {
    const started = new Date(run.started_at);
    const recent = now.getTime() - started.getTime() <= RECENT_WINDOW_MS;
    if (recent) {
      runsInWindow += 1;
      if (run.job_status === "failed" || run.job_status === "partial") problemRuns += 1;
    }

    if (bySource.has(run.api_source)) continue;
    bySource.set(run.api_source, {
      source: formatSource(run.api_source),
      raw: run.api_source,
      status: run.job_status,
      statusLabel: labelForStatus(run.job_status),
      tone: toneForStatus(run.job_status),
      lastRunAt: run.started_at,
      relative: formatRelativeTime(started, now),
      summary: summariseRun(run),
      recent,
    });
  }

  const all = [...bySource.values()];
  const sorted = all
    .slice()
    .sort(
      (a, b) =>
        attentionRank(a) - attentionRank(b) ||
        new Date(b.lastRunAt).getTime() - new Date(a.lastRunAt).getTime(),
    );

  const latest = all.reduce<SourceImportHealth | null>(
    (newest, row) =>
      newest === null || new Date(row.lastRunAt) > new Date(newest.lastRunAt) ? row : newest,
    null,
  );

  return {
    verdict: problemRuns > 0 ? "problems" : runsInWindow === 0 ? "quiet" : "healthy",
    sources: sorted.slice(0, MAX_SOURCES),
    sourceCount: all.length,
    problemRuns,
    runsInWindow,
    latest,
  };
}
