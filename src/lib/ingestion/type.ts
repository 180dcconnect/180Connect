// Shared contract between the ingestion runner and each data-source adapter (F038).
//
// Imports across this module use explicit `.ts` extensions: `npm test` and the
// scripts in `scripts/` run through node's type stripping, which does not resolve
// extensionless specifiers. See the note in tsconfig.json.

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
  name:
    | "charitybase"
    | "companies_house"
    | "360giving"
    | "find_that_charity"
    | "globalgiving"
    | "candid";
  fetch(): Promise<SourceFetchResult>;
  onError(err: Error): void;
}
