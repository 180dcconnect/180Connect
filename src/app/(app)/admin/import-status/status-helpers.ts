// Pure status-label/style logic, split out from status-badge.tsx so it can
// be tested with node:test directly — Node can strip plain .ts type
// annotations, but not .tsx JSX syntax, without a real build step.

import { formatRelativeTime } from "../../../../lib/display-format.ts";

const STYLES: Record<string, string> = {
  completed: "bg-green-50 text-green-800",
  partial: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-800",
  running: "bg-blue-50 text-blue-800",
  stalled: "bg-amber-50 text-amber-800",
};

const LABELS: Record<string, string> = {
  completed: "Succeeded",
  partial: "Partially succeeded",
  failed: "Failed",
  running: "Running",
  stalled: "Stalled",
};

export function styleForStatus(status: string): string {
  return STYLES[status] ?? "bg-gray-50 text-gray-800";
}

export function labelForStatus(status: string): string {
  return LABELS[status] ?? status;
}

/**
 * How long a run may sit in `running` before the screens stop calling it
 * running. Nothing legitimate runs this long: imports are capped by the
 * serverless ceiling (300s on the import pages, less on the cron routes),
 * and the weekly rechecks and backfill slices finish in minutes. Past this
 * point the run was interrupted — the function was killed, the deploy moved,
 * or the failure write itself failed (the case `runner.ts` already documents
 * as "left 'running' and will need reconciling") — and no later write will
 * ever close it. Thirty minutes is six times the longest legitimate run, so
 * this never fires on a slow-but-alive job.
 *
 * Display-only: the stored `job_status` stays `running`. Rewriting history
 * would destroy the evidence of what happened; labelling it honestly keeps it.
 */
export const STALLED_RUN_AFTER_MS = 30 * 60 * 1_000;

/**
 * Whether a `running` run started long enough ago that it cannot still be
 * going. False for anything unreadable — a bad timestamp is a reason to say
 * nothing, never a reason to declare a stall.
 */
export function isStalledRun(
  startedAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (startedAt === null || startedAt === undefined) return false;
  const at = startedAt instanceof Date ? startedAt.getTime() : Date.parse(startedAt);
  if (Number.isNaN(at)) return false;
  return now.getTime() - at >= STALLED_RUN_AFTER_MS;
}

/**
 * The status the screens show for a run: `stalled` for a run the database
 * still calls `running` but `isStalledRun` has given up on, otherwise the
 * stored status unchanged. Every surface — the badge, the import-status
 * sentences, the per-source histories, the dashboard card — reads this one
 * helper, so a stuck run never says "Running" in one place and "Stalled" in
 * another.
 */
export function runDisplayStatus(
  jobStatus: string,
  startedAt: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (jobStatus === "running" && isStalledRun(startedAt, now)) return "stalled";
  return jobStatus;
}

/**
 * The one sentence every surface uses for a stalled run, in words rather
 * than counts: whatever counts an interrupted run holds are frozen mid-write
 * and would mislead, while the two facts that matter — when it started, and
 * that starting over is safe — fit in one line.
 */
export function stalledRunSummary(
  startedAt: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const at = startedAt instanceof Date ? startedAt : new Date(startedAt ?? NaN);
  const when = Number.isNaN(at.getTime())
    ? "some time ago"
    : formatRelativeTime(at, now);
  return `Stalled — started ${when} and never finished. Running it again is safe.`;
}