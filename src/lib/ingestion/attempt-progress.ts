// Reads a live 360Giving backfill attempt off its ingestion_runs row.
//
// Pure by design, same reasoning as the standardize mappers: the row arrives
// as untyped JSON from the database, and deciding "what does this row say?"
// should be testable without one. The poll action in
// src/app/admin/three-sixty-giving/actions.ts does the fetching; this module
// does the interpreting.

import type { JobStatus } from "./type.ts";

/** The columns the poll action selects — a subset of the ingestion_runs row. */
export type AttemptRunRow = {
  id: string;
  started_at: string;
  job_status: JobStatus;
  run_stats: unknown;
};

export type AttemptProgress = {
  /** Organisations walked so far, or null when no heartbeat has landed yet. */
  walked: number | null;
  /** Organisations the walk will attempt, or null when unknown. */
  total: number | null;
};

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Extracts the live walked/total count the runner's progress heartbeats write
 * into `run_stats`. Anything unexpected — null stats (no heartbeat yet, or a
 * finished run whose final stats carry no funnel), a non-object, non-numeric
 * values — reads as unknown rather than throwing: a missing heartbeat is a
 * normal mid-run state, not a corrupt row.
 */
export function parseAttemptProgress(row: AttemptRunRow): AttemptProgress {
  const stats = row.run_stats;
  if (typeof stats !== "object" || stats === null) {
    return { walked: null, total: null };
  }
  const record = stats as Record<string, unknown>;
  return {
    walked: asCount(record.walked_organisations),
    total: asCount(record.total_organisations),
  };
}
