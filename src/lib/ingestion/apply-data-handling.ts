// The one place external data is cleared for storage (F246 + F247).
//
// F247 AC3 asks for the exclusion rules to be "applied consistently across every
// import source (F031-F038), not implemented differently per source". F246 met
// that for the scheduled sources by putting `filterPayload` inside
// `partitionRecords` — but `partitionRecords` is the runner's, and a source that
// does not run through the runner does not get it. F037's manual URL import is
// exactly that source: it upserts a fetched page into `raw_source_records`
// directly, and inherits no rules at all.
//
// The fix is not to remember to call the filter in a second place. It is for there
// to be one function that turns a raw payload into a storable one, for it to
// return the bookkeeping columns that go with it, and for every writer to have no
// other way in. That is this file.
//
// Two passes, in this order:
//
//   1. **Field removal** (F246). Named paths are deleted outright.
//   2. **Content redaction** (F247). What survives is scanned for personal email
//      addresses and telephone numbers, which are replaced in place.
//
// Removal first is not arbitrary. Redaction walks strings, which is the expensive
// half, and there is no reason to walk a field that is about to be deleted — nor
// to record a redaction against a field that does not end up stored.
//
// Both halves report into one `excluded_fields` array, so the F246 audit surface
// (`data_handling_filter_summary()`, the admin screen, the backfill's counters)
// covers F247 without a second schema or a second screen. A bare path means a
// field was removed; `path#kind` means a field was kept and scrubbed.

import { filterPayload, type FieldRule } from "./field-filter.ts";
import {
  redactPayload,
  type RedactionCounts,
  type RedactionRule,
} from "./personal-data.ts";

/**
 * Everything needed to clear a payload, loaded once per run rather than per record.
 *
 * Carried as one object rather than four arguments because it is threaded through
 * `runIngestion` → `runOneSource` → `partitionRecords`, and a four-argument tail
 * that every layer has to forward correctly is how the F037 gap happened in the
 * first place.
 */
export type DataHandlingPolicy = {
  fieldRules: FieldRule[];
  redactionRules: RedactionRule[];
  /**
   * Email local parts that name a role rather than a person, from
   * `public.personal_email_role_parts`. Everything not in here is treated as
   * personal — see the allow-list reasoning in personal-data.ts.
   */
  roleLocalParts: ReadonlySet<string>;
  /** `data_handling_rule_versions.current_version` at load time. */
  version: number;
};

/** An empty policy. Only for tests and for callers that opt out explicitly. */
export const NO_DATA_HANDLING: DataHandlingPolicy = {
  fieldRules: [],
  redactionRules: [],
  roleLocalParts: new Set(),
  version: 0,
};

export type ClearedPayload = {
  /** What may be stored. */
  payload: unknown;
  /**
   * What the rules did, for `raw_source_records.excluded_fields`. Always an
   * array — the null case ("the rules never ran against this row") belongs to the
   * caller, which knows whether it had a policy at all.
   */
  excludedFields: string[];
  /** Per-kind redaction totals, for run-level reporting. Never the matched values. */
  redactionCounts: RedactionCounts;
};

/**
 * Clears one payload for storage under the active rules.
 *
 * Pure: no database, no clock, no logging. The rules come in as data so this is
 * assertable directly, and so the backfill can run the identical decision over
 * stored rows without a second implementation drifting away from this one.
 */
export function applyDataHandling(
  payload: unknown,
  source: string,
  policy: DataHandlingPolicy,
): ClearedPayload {
  const { filtered, excludedFields } = filterPayload(
    payload,
    policy.fieldRules,
    source,
  );

  const redaction = redactPayload(
    filtered,
    policy.redactionRules,
    source,
    policy.roleLocalParts,
  );

  return {
    payload: redaction.redacted,
    excludedFields: [...excludedFields, ...redaction.applied],
    redactionCounts: redaction.counts,
  };
}
