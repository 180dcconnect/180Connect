// Ingestion runner (F038 + F246): fetches from each registered source and writes
// payloads into raw_source_records, one ingestion_runs row per source.
//
// F246 (Public Data Handling Rules): before a payload is checksummed or written,
// the runner applies the active deny rules from data_handling_rules. Denied fields
// are stripped from raw_payload, and the record notes which fields were removed
// and under which version of the rules — satisfying the data handling policy §2.
//
// Runs outside Next.js (see scripts/ and the future scheduled job), which is why the
// default store builds its client from `admin-client-factory` rather than `admin.ts`.
//
// The runner holds the decisions; all PostgREST detail is behind IngestionStore.

import {
  applyDataHandling,
  type DataHandlingPolicy,
} from "./apply-data-handling.ts";
import { hashPayload } from "./checksum.ts";
import { createDefaultIngestionStore } from "./store.ts";
import type {
  CommonRecord,
  DataSourceAdapter,
  DataSourceName,
  IngestionStore,
  JobStatus,
  RawRecordRow,
  RunCounts,
  RunSummary,
  RunTrigger,
} from "./type.ts";

export type InvalidRecord = { index: number; reason: string };

/**
 * Supabase's PostgrestError (and similar client errors) carry a `.message` but
 * are plain objects, not `instanceof Error` — `String(err)` on those collapses
 * to the useless "[object Object]", which is what ended up in `ingestion_runs`
 * and error tracking instead of the real reason (e.g. "Invalid API key").
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

export type Partitioned = {
  rows: RawRecordRow[];
  /** Unchanged records, plus duplicates collapsed within this same batch. */
  skipped: number;
  /** Of `rows`, how many replace an existing record whose payload changed. */
  changed: number;
  invalid: InvalidRecord[];
};

/**
 * Sorts a source's records into write / skip / reject, without touching the database.
 *
 * Exported for its own tests: this is where the dedup and validation decisions live,
 * and they are worth asserting directly rather than only through an integration run.
 *
 * Four things happen here:
 *
 * 1. **Validation.** A record with no usable `source_record_id`, or a null payload,
 *    is rejected rather than sent to the database — `source_record_id` is NOT NULL,
 *    so one malformed record would otherwise abort the whole batch and take the
 *    other 999 with it. Rejected records land in `records_failed`.
 * 2. **Data handling (F246 + F247).** The payload goes through
 *    `applyDataHandling` before checksumming: denied fields are removed, and
 *    personal email addresses and phone numbers are redacted from what survives.
 *    The list of what the rules did and the rule version are recorded on each row.
 *    Clearing before the checksum is deliberate: the stored checksum describes
 *    what was actually stored, so tightening a rule changes it and the next run
 *    rewrites the record rather than skipping it as unchanged.
 *
 *    `policy` doubles as the "were rules applied at all?" flag. Pass one (even an
 *    empty one, meaning no rules are seeded yet) and every row records
 *    `excluded_fields` as an array — empty if nothing matched. Pass null and the
 *    rows record null, meaning the rules never ran against them.
 * 3. **Intra-batch duplicates.** Paging a search can return the same company twice.
 *    Postgres refuses an ON CONFLICT DO UPDATE that touches a row twice in one
 *    statement (21000), so the first occurrence wins and the rest count as skipped.
 * 4. **Change detection.** An existing record whose checksum matches is skipped; one
 *    whose payload changed is rewritten with `ingestion_attempt` incremented.
 */
export function partitionRecords(
  records: CommonRecord[],
  existing: Map<string, { checksum: string; ingestion_attempt: number }>,
  runId: string,
  source: DataSourceName,
  policy: DataHandlingPolicy | null = null,
): Partitioned {
  const rows: RawRecordRow[] = [];
  const invalid: InvalidRecord[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let changed = 0;

  records.forEach((record, index) => {
    const id = record?.source_record_id;
    if (typeof id !== "string" || id.trim() === "") {
      invalid.push({ index, reason: "missing or empty source_record_id" });
      return;
    }
    if (record.raw_payload === null || record.raw_payload === undefined) {
      invalid.push({ index, reason: `record ${id} has no raw_payload` });
      return;
    }

    if (seen.has(id)) {
      skipped++;
      return;
    }
    seen.add(id);

    // F246 + F247: clear the payload for storage before checksumming. The
    // checksum reflects what is actually stored, so a rule change correctly
    // triggers re-ingestion of previously-unchanged records.
    const cleared = policy
      ? applyDataHandling(record.raw_payload, source, policy)
      : { payload: record.raw_payload, excludedFields: [], redactionCounts: {} };

    const checksum = hashPayload(cleared.payload);
    const previous = existing.get(id);

    if (previous?.checksum === checksum) {
      skipped++;
      return;
    }
    if (previous) changed++;

    rows.push({
      ingestion_run_id: runId,
      record_source: source,
      source_record_id: id,
      raw_payload: cleared.payload,
      checksum,
      source_country: record.source_country ?? null,
      source_registry_name: record.source_registry_name ?? null,
      ingestion_attempt: previous ? previous.ingestion_attempt + 1 : 1,
      // Null and [] mean different things and an audit depends on the difference:
      // null = the rules were never applied to this row, [] = they were applied and
      // matched nothing. Only a caller that passes no policy at all gets null.
      excluded_fields: policy ? cleared.excludedFields : null,
      rule_version_applied: policy ? policy.version : null,
    });
  });

  return { rows, skipped, changed, invalid };
}

async function runOneSource(
  store: IngestionStore,
  source: DataSourceAdapter,
  trigger: RunTrigger,
  policy: DataHandlingPolicy,
): Promise<RunSummary> {
  const counts: RunCounts = { fetched: 0, inserted: 0, skipped: 0, failed: 0 };
  const written = { new: 0, changed: 0 };

  let run: { id: string };
  try {
    run = await store.startRun(source.name, trigger);
  } catch (err) {
    // No run row exists, so there is nothing to mark failed. Report and let the
    // other sources carry on.
    source.onError(err as Error);
    return {
      source: source.name,
      status: "failed",
      counts,
      written,
      runId: null,
      error: errorMessage(err),
    };
  }

  try {
    const { records, truncated, walkedOrganisations } = await source.fetch();
    counts.fetched = records.length;

    const existing = await store.loadChecksums(
      source.name,
      records
        .map((record) => record?.source_record_id)
        .filter((id): id is string => typeof id === "string" && id !== ""),
    );

    const { rows, skipped, changed, invalid } = partitionRecords(
      records,
      existing,
      run.id,
      source.name,
      policy,
    );

    await store.writeRecords(rows);

    counts.inserted = rows.length;
    counts.skipped = skipped;
    counts.failed = invalid.length;
    written.new = rows.length - changed;
    written.changed = changed;

    for (const bad of invalid) {
      console.warn(
        `[${source.name}] rejected record ${bad.index}: ${bad.reason}`,
      );
    }

    // `partial` is a successful run that did not get everything: the source capped
    // its own result set, or some records were unusable. Neither is a failure.
    const status: JobStatus =
      truncated || invalid.length > 0 ? "partial" : "completed";

    await store.finishRun(run.id, status, counts);

    console.log(
      `[${source.name}] fetched ${counts.fetched}, written ${rows.length} ` +
        `(${written.new} new, ${changed} changed), skipped ${skipped}, ` +
        `rejected ${invalid.length}` +
        `${truncated ? " — hit the source's result ceiling" : ""}`,
    );

    return {
      source: source.name,
      status,
      counts,
      written,
      runId: run.id,
      walkedOrganisations,
    };
  } catch (err) {
    // Anything not yet written failed with the batch.
    counts.failed = counts.fetched - counts.inserted - counts.skipped;
    const message = errorMessage(err);
    source.onError(err as Error);

    try {
      await store.finishRun(run.id, "failed", counts, message);
    } catch (finishErr) {
      // Marking the run failed itself failed. The row is left 'running' and will
      // need reconciling, but the other sources are unaffected.
      source.onError(finishErr as Error);
    }

    return {
      source: source.name,
      status: "failed",
      counts,
      written,
      runId: run.id,
      error: message,
    };
  }
}

/**
 * Runs every source concurrently and resolves once all of them have settled.
 *
 * Concurrent rather than sequential because F038 AC2 is about sources "running at
 * the same time": with `Promise.allSettled` no source can affect another even in
 * principle — there is no shared control flow for a throw to escape into — whereas a
 * sequential loop only isolates them as carefully as its try/catch placement, which
 * is exactly what went wrong the first time. Each source writes rows tagged with its
 * own `record_source`, so their upserts cannot contend on the unique constraint.
 *
 * Unbounded: the Data Model tops out at six sources, each spending most of its time
 * waiting on someone else's API. If that list grows enough to matter, add a limit
 * here rather than in the adapters.
 */
export async function runIngestion(
  sources: DataSourceAdapter[],
  trigger: RunTrigger = { triggeredBy: "manual" },
  store: IngestionStore | null = createDefaultIngestionStore(),
): Promise<RunSummary[]> {
  if (!store) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  // F246 + F247: load the data handling policy once for the entire run — every
  // source uses the same snapshot, so a rule change mid-run cannot produce
  // inconsistency.
  //
  // **Fail-closed.** If the rules cannot be read, no source runs. The data handling
  // policy §2 commits to a denied field never being written; carrying on unfiltered
  // would store precisely the personal data the rules exist to keep out, and would
  // do it silently. Better to import nothing than to import a home address.
  //
  // This throws before any `ingestion_runs` row is opened, so there is no half-run
  // to reconcile. Every caller already wraps `runIngestion` in a try/catch that
  // reports the error and shows the operator a failure, so the blocked import is
  // visible rather than quietly degraded.
  let policy: DataHandlingPolicy;
  try {
    policy = await store.loadDataHandlingPolicy();
  } catch (err) {
    throw new Error(
      `Data handling rules could not be loaded: ${errorMessage(err)}. ` +
        `Ingestion is blocked until they are readable — no data is imported ` +
        `unfiltered (F246).`,
      { cause: err },
    );
  }

  const settled = await Promise.allSettled(
    sources.map((source) => runOneSource(store, source, trigger, policy)),
  );

  // runOneSource catches its own failures, so a rejection here means a bug in the
  // runner rather than in a source. Surface it without losing the other results.
  return settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      source: sources[index].name,
      status: "failed" as const,
      counts: { fetched: 0, inserted: 0, skipped: 0, failed: 0 },
      written: { new: 0, changed: 0 },
      runId: null,
      error: String(result.reason),
    };
  });
}
