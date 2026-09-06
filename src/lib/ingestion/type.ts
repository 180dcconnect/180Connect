// Shared contract between the ingestion runner and each data-source adapter (F038).
//
// Imports across this module use explicit `.ts` extensions: `npm test` and the
// scripts in `scripts/` run through node's type stripping, which does not resolve
// extensionless specifiers. See the note in tsconfig.json.

import type { DataHandlingPolicy } from "./apply-data-handling.ts";

/**
 * Every source the pipeline knows about, defined once.
 *
 * This is the only place in the codebase the list appears. In the database it is
 * the `public.data_source_name` domain, also defined once and shared by both
 * columns that use it — so adding a seventh source is two additive edits (one line
 * here, one `alter domain` in a new migration) rather than an edit to a type union
 * plus two duplicated check constraints (F038 AC1/AC3).
 *
 * The order matches the Data Model's "03 Raw Data" tab.
 */
export const DATA_SOURCES = [
  "charitybase",
  "companies_house",
  "360giving",
  "find_that_charity",
  "globalgiving",
  "candid",
  "charity_commission",
  // Not an API: an organisation's own website, fetched one page at a time by a CAM
  // through F037's manual URL import. It has no DataSourceAdapter because there is
  // nothing to enumerate — see src/lib/import/fetch-page.ts.
  "website",
  // The Charity Commission's daily bulk register extract, kept apart from the
  // API source because the payload shape differs and dedup is keyed on
  // (record_source, source_record_id) — sharing a value would let a bulk row and
  // an API row for the same charity overwrite each other. See
  // supabase/migrations/20260922094000_add_charity_commission_bulk_data_source.sql.
  "charity_commission_bulk",
] as const;

export type DataSourceName = (typeof DATA_SOURCES)[number];

/** One record as fetched from a source, before any validation or matching. */
export interface CommonRecord {
  source_record_id: string;
  /** The source API's response for this record, exactly as received. Never transformed. */
  raw_payload: unknown;
  source_country?: string;
  source_registry_name?: string;
}

/**
 * What an adapter returns from `fetch()`.
 *
 * `truncated` is part of the contract rather than a property smuggled onto the
 * records array: several sources cap how deep their result set can be paged
 * (Companies House stops at ~1000), and a run that stopped at a ceiling is
 * `partial`, not `completed`. An adapter that cannot truncate returns `false`.
 */
export interface SourceFetchResult {
  records: CommonRecord[];
  truncated: boolean;
  /**
   * How many organisation-level lookups this source's walk actually performed.
   * Optional and source-specific: bulk adapters that iterate known identifiers
   * (360giving, …) report the identifier count, single-org lookups report 1.
   * Zero means "there was nothing to walk", which is a different outcome from
   * "everything was walked and nothing was found" — callers use it to say so.
   */
  walkedOrganisations?: number;
  /**
   * Source-specific detail about how the fetch reached its record count, stored
   * whole on `ingestion_runs.run_stats` and read whole by the admin pages.
   *
   * The Charity Commission bulk import reports its accept/reject funnel here —
   * scanned, registered, passed income, passed sector, accepted — because that
   * funnel is the only record of *why* a filter selected what it selected, and a
   * filter accidentally widened from 4,704 to 40,000 is otherwise invisible
   * until the client list is full of organisations nobody will contact.
   *
   * Flat numbers only, and never authoritative: `RunCounts` stays the record of
   * what happened. Nothing in the database or the app computes from this.
   */
  stats?: Record<string, number>;
}

/** Implemented once per external source. The runner knows nothing else about them. */
export interface DataSourceAdapter {
  name: DataSourceName;
  /**
   * Optional progress sink, called as the fetch works through its own units
   * of work. Only adapters whose fetch is a long per-organisation walk
   * (360giving) emit it — every other adapter ignores the argument, so this
   * stays optional and no existing adapter changes. The runner persists each
   * report onto the run row, so a client polling `ingestion_runs` sees a live
   * walked/total count instead of a frozen spinner.
   */
  fetch(reportProgress?: FetchProgressCallback): Promise<SourceFetchResult>;
  onError(err: Error): void;
}

/**
 * Incremental progress from a long fetch, reported while it runs.
 *
 * `walked` counts organisation-level lookups completed so far; `total` is how
 * many the walk will attempt. Flat numbers, same convention as
 * SourceFetchResult.stats — nothing computes from them, they are only read by
 * the admin screens.
 */
export type FetchProgress = {
  walked: number;
  total: number;
};

/** Receives FetchProgress reports during `fetch()`. Synchronous and non-throwing: the runner persists the report in the background. */
export type FetchProgressCallback = (progress: FetchProgress) => void;

export type JobStatus = "running" | "completed" | "failed" | "partial";

export type RunCounts = {
  fetched: number;
  inserted: number;
  skipped: number;
  failed: number;
};

export type RunTrigger = {
  /** 'schedule' for the cron job, 'manual' for an admin-triggered run. */
  triggeredBy: "schedule" | "manual";
  /** The admin who triggered a manual run. Null for scheduled runs. */
  triggeredByUserId?: string | null;
};

/** A row destined for raw_source_records. */
export type RawRecordRow = {
  ingestion_run_id: string;
  record_source: DataSourceName;
  source_record_id: string;
  raw_payload: unknown;
  checksum: string;
  source_country: string | null;
  source_registry_name: string | null;
  ingestion_attempt: number;
  /**
   * Field paths stripped by the data handling rules (F246). An empty array means
   * the rules ran and matched nothing; null means they never ran against this row.
   */
  excluded_fields: string[] | null;
  /** Which rule version was in force. Null means the rules never ran. */
  rule_version_applied: number | null;
};

/**
 * Everything the runner needs from the database, behind an interface.
 *
 * The runner talks to this rather than to Supabase directly, so its behaviour —
 * failure isolation, dedup counting, status selection — is testable without a
 * database. `createSupabaseIngestionStore` in store.ts is the real implementation;
 * the tests supply a fake.
 */
export interface IngestionStore {
  startRun(source: DataSourceName, trigger: RunTrigger): Promise<{ id: string }>;
  loadChecksums(
    source: DataSourceName,
    sourceRecordIds: string[],
  ): Promise<Map<string, { checksum: string; ingestion_attempt: number }>>;
  writeRecords(rows: RawRecordRow[]): Promise<void>;
  /**
   * Records incremental fetch progress on a still-running run row, written
   * into `run_stats` as `{ walked_organisations, total_organisations }` for a
   * client polling the run to read.
   *
   * Best-effort by contract: the runner swallows a rejection rather than
   * failing the import over it, and `finishRun` overwrites `run_stats` with
   * the source's final stats, so a missed heartbeat leaves no trace.
   */
  updateRunProgress(runId: string, progress: FetchProgress): Promise<void>;
  finishRun(
    runId: string,
    status: JobStatus,
    counts: RunCounts,
    errorMessage?: string,
    /** SourceFetchResult.stats, or undefined for a source that reports none. */
    stats?: Record<string, number>,
  ): Promise<void>;
  /**
   * Loads everything needed to clear a payload for storage (F246 + F247): the
   * active field rules, the active redaction rules, the role email allow-list and
   * the current rule version.
   *
   * Called once per ingestion run, not per record — so a rule change mid-run
   * cannot produce a batch where some rows were filtered under one policy and
   * some under another.
   */
  loadDataHandlingPolicy(): Promise<DataHandlingPolicy>;
}

/** What `runIngestion` reports back for each source it was given. */
export type RunSummary = {
  source: DataSourceName;
  status: JobStatus;
  counts: RunCounts;
  /** New rows vs rows rewritten because their payload changed. Logged, not stored. */
  written: { new: number; changed: number };
  /**
   * How many organisation-level lookups the source's fetch performed (see
   * SourceFetchResult.walkedOrganisations). Undefined for sources that don't
   * report it. A completed run with walkedOrganisations === 0 imported nothing
   * because there was nothing to walk — distinct from a run that walked N and
   * found no new data.
   */
  walkedOrganisations?: number;
  /** Whatever the source reported as SourceFetchResult.stats, passed through. */
  stats?: Record<string, number>;
  /**
   * The ingestion_runs row this summary corresponds to. Null only when startRun
   * itself failed — no row exists to reference. Callers that discover something
   * worth recording against the run after runIngestion returns (e.g. a status-
   * recheck job's flagged count, F049 AC3) update that row directly by this id.
   */
  runId: string | null;
  error?: string;
};
