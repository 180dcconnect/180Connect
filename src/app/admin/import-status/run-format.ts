/**
 * Turns an `ingestion_runs` row into something a person can read.
 *
 * The old page put eight numeric columns and a snake_case source name in a
 * table and left the reader to work out what had happened. The numbers are the
 * same; what changes here is that each run states its outcome in a sentence
 * first, and the counts are support for it rather than the whole message.
 *
 * Pure and node-testable, same split as `src/lib/audit-log-format.ts` — and it
 * borrows that page's time helpers rather than restating them, so a run and an
 * audit entry never disagree about what "2 hours ago" means.
 */

import {
  dayKeyOf,
  formatDayLabel,
  formatDuration,
  formatExactTime,
  formatRelativeTime,
  humaniseToken,
  // Relative, not `@/lib/...`: node --test strips types but does not resolve the
  // tsconfig path alias, and this module is tested directly.
} from "../../../lib/display-format.ts";
import { labelForStatus } from "./status-helpers.ts";

/**
 * The six sources in `public.data_source_name`, plus `charity_commission` from
 * `DATA_SOURCES` in `src/lib/ingestion/type.ts`. A source with no entry falls
 * back to its humanised token, so adding a seventh to the domain shows up here
 * spelled tolerably on the day it first runs.
 */
const SOURCE_LABELS: Record<string, string> = {
  charitybase: "CharityBase",
  charity_commission: "Charity Commission",
  companies_house: "Companies House",
  "360giving": "360Giving",
  find_that_charity: "Find That Charity",
  globalgiving: "GlobalGiving",
  candid: "Candid",
};

export function formatSource(source: string): string {
  return SOURCE_LABELS[source] ?? humaniseToken(source);
}

/**
 * Which of the badge's four colours a run's chrome takes. Deliberately the same
 * four keys `status-helpers.ts` styles, because the badge is the thing on this
 * page people already read the status from — the icon disc and the counts just
 * agree with it.
 */
export type RunTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<string, RunTone> = {
  completed: "success",
  partial: "warning",
  failed: "danger",
  running: "info",
};

export function toneForStatus(status: string): RunTone {
  return TONES[status] ?? "neutral";
}

export type IngestionRunRow = {
  id: string;
  api_source: string;
  job_status: "running" | "completed" | "failed" | "partial";
  records_fetched: number;
  records_inserted: number;
  records_skipped: number;
  records_failed: number;
  records_flagged: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
};

/** One count, ready to render. Zeroes are kept — "0 failed" is reassuring. */
export type RunCount = { label: string; value: number; tone: RunTone };

export type RunView = {
  id: string;
  source: string;
  status: string;
  statusLabel: string;
  tone: RunTone;
  /** What happened, in one line. */
  summary: string;
  counts: RunCount[];
  /** The counts worth putting on a collapsed row: the ones that aren't zero. */
  highlights: RunCount[];
  errorMessage: string | null;
  startedRelative: string;
  startedExact: string;
  finishedExact: string | null;
  duration: string;
  dayKey: string;
  dayLabel: string;
};

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/**
 * The outcome as a sentence. Built from the counts rather than from the status
 * alone: two `completed` runs where one added ten thousand records and the other
 * added nothing are not the same event, and the status badge cannot tell them
 * apart.
 */
export function summariseRun(run: IngestionRunRow): string {
  const { records_fetched: fetched, records_inserted: inserted } = run;

  if (run.job_status === "running") {
    return fetched > 0
      ? `Running now — ${plural(fetched, "record")} fetched so far`
      : "Running now — nothing fetched yet";
  }

  if (run.job_status === "failed") {
    return fetched > 0
      ? `Failed after fetching ${plural(fetched, "record")}`
      : "Failed before fetching anything";
  }

  if (fetched === 0) return "Nothing to fetch — the source returned no records";

  const added =
    inserted === 0
      ? `Added nothing new from ${plural(fetched, "record")}`
      : `Added ${inserted.toLocaleString()} of ${plural(fetched, "record")}`;

  // `partial` is the status for a run that hit a source's paging ceiling or lost
  // some records on the way, so the sentence has to say the number is not the
  // whole story — otherwise it reads as a clean success with a yellow badge.
  return run.job_status === "partial" ? `${added} — the run did not finish cleanly` : added;
}

export function describeRun(run: IngestionRunRow, now: Date): RunView {
  const started = new Date(run.started_at);
  const finished = run.completed_at ? new Date(run.completed_at) : null;

  const counts: RunCount[] = [
    { label: "Fetched", value: run.records_fetched, tone: "neutral" },
    { label: "Added", value: run.records_inserted, tone: "success" },
    { label: "Skipped", value: run.records_skipped, tone: "neutral" },
    { label: "Failed", value: run.records_failed, tone: "danger" },
    { label: "Flagged", value: run.records_flagged, tone: "warning" },
  ];

  return {
    id: run.id,
    source: formatSource(run.api_source),
    status: run.job_status,
    statusLabel: labelForStatus(run.job_status),
    tone: toneForStatus(run.job_status),
    summary: summariseRun(run),
    counts,
    // The collapsed row carries only what happened. A row of five counts where
    // four are zero is four pieces of furniture around one fact.
    highlights: counts.filter((count) => count.value > 0),
    errorMessage: run.error_message,
    startedRelative: formatRelativeTime(started, now),
    startedExact: formatExactTime(started),
    finishedExact: finished ? formatExactTime(finished) : null,
    // A run still going has no duration yet, and guessing one from `now` would
    // show a number that changes every refresh for a reason nothing explains.
    duration: finished ? formatDuration(finished.getTime() - started.getTime()) : "—",
    dayKey: dayKeyOf(started),
    dayLabel: formatDayLabel(started, now),
  };
}

/** Free-text search over what the reader can see, same contract as the audit log. */
export function matchesRunQuery(view: RunView, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const haystack = [view.source, view.statusLabel, view.status, view.summary, view.errorMessage ?? ""]
    .join(" ")
    .toLowerCase();
  return term.split(/\s+/).every((word) => haystack.includes(word));
}
