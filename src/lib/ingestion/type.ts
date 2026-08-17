// Shared contract between the ingestion runner and each data-source adapter (F038).
//
// Imports across this module use explicit `.ts` extensions: `npm test` and the
// scripts in `scripts/` run through node's type stripping, which does not resolve
// extensionless specifiers. See the note in tsconfig.json.

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
}

/** Implemented once per external source. The runner knows nothing else about them. */
export interface DataSourceAdapter {
  name: DataSourceName;
  fetch(): Promise<SourceFetchResult>;
  onError(err: Error): void;
}

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
  finishRun(
    runId: string,
    status: JobStatus,
    counts: RunCounts,
    errorMessage?: string,
  ): Promise<void>;
}

/** What `runIngestion` reports back for each source it was given. */
export type RunSummary = {
  source: DataSourceName;
  status: JobStatus;
  counts: RunCounts;
  /** New rows vs rows rewritten because their payload changed. Logged, not stored. */
  written: { new: number; changed: number };
  error?: string;
};
