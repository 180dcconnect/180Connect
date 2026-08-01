// Ingestion runner (F038): fetches from each registered source and writes the
// untouched payloads into raw_source_records, one ingestion_runs row per source.
//
// Runs outside Next.js (see scripts/ and the future scheduled job), which is why it
// builds its Supabase client from `admin-client-factory` rather than `admin.ts`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommonRecord, DataSourceAdapter } from "./type.ts";
import { buildAdminClient } from "../supabase/admin-client-factory.ts";
import { hashPayload } from "./checksum.ts";

/** Rows per round trip when reading existing checksums and when upserting. */
const BATCH_SIZE = 500;

export type RunTrigger = {
  /** 'schedule' for the cron job, 'manual' for an admin-triggered run. */
  triggeredBy: "schedule" | "manual";
  /** The admin who triggered a manual run. Null for scheduled runs. */
  triggeredByUserId?: string | null;
};

type RunCounts = {
  fetched: number;
  inserted: number;
  skipped: number;
  failed: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function startRun(
  supabase: SupabaseClient,
  source: string,
  trigger: RunTrigger,
) {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .insert({
      api_source: source,
      triggered_by: trigger.triggeredBy,
      triggered_by_user_id: trigger.triggeredByUserId ?? null,
      job_status: "running",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Reads the checksum of every record we already hold for this source, keyed by
 * source_record_id.
 *
 * Batched deliberately: a per-record existence check is two round trips per record,
 * which is ~2000 sequential queries for one Companies House run. This is
 * `ceil(n / BATCH_SIZE)` instead.
 */
async function loadExistingChecksums(
  supabase: SupabaseClient,
  source: string,
  sourceRecordIds: string[],
): Promise<Map<string, { checksum: string; ingestion_attempt: number }>> {
  const existing = new Map<
    string,
    { checksum: string; ingestion_attempt: number }
  >();

  for (const batch of chunk(sourceRecordIds, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("raw_source_records")
      .select("source_record_id, checksum, ingestion_attempt")
      .eq("record_source", source)
      .in("source_record_id", batch);

    if (error) throw error;

    for (const row of data ?? []) {
      existing.set(row.source_record_id, {
        checksum: row.checksum,
        ingestion_attempt: row.ingestion_attempt,
      });
    }
  }

  return existing;
}

/**
 * Writes the records that are new or whose payload changed, skipping the rest.
 *
 * `inserted` counts rows written — new rows plus rows whose payload changed — so
 * that fetched = inserted + skipped + failed reconciles. The split between the two
 * is logged; there is no `records_updated` column in the Data Model.
 */
async function storeRawRecords(
  supabase: SupabaseClient,
  runId: string,
  source: string,
  records: CommonRecord[],
): Promise<{ inserted: number; updated: number; skipped: number }> {
  const existing = await loadExistingChecksums(
    supabase,
    source,
    records.map((record) => record.source_record_id),
  );

  let updated = 0;
  let skipped = 0;
  const rows = [];

  for (const record of records) {
    const checksum = hashPayload(record.raw_payload);
    const previous = existing.get(record.source_record_id);

    if (previous?.checksum === checksum) {
      skipped++;
      continue;
    }

    if (previous) updated++;

    rows.push({
      ingestion_run_id: runId,
      record_source: source,
      source_record_id: record.source_record_id,
      raw_payload: record.raw_payload,
      checksum,
      source_country: record.source_country ?? null,
      source_registry_name: record.source_registry_name ?? null,
      ingestion_attempt: previous ? previous.ingestion_attempt + 1 : 1,
    });
  }

  for (const batch of chunk(rows, BATCH_SIZE)) {
    const { error } = await supabase
      .from("raw_source_records")
      .upsert(batch, { onConflict: "record_source,source_record_id" });

    if (error) throw error;
  }

  return { inserted: rows.length, updated, skipped };
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  status: string,
  counts: RunCounts,
  errorMessage?: string,
) {
  const { error } = await supabase
    .from("ingestion_runs")
    .update({
      job_status: status,
      completed_at: new Date().toISOString(),
      records_fetched: counts.fetched,
      records_inserted: counts.inserted,
      records_skipped: counts.skipped,
      records_failed: counts.failed,
      error_message: errorMessage ?? null,
    })
    .eq("id", runId);

  if (error) throw error;
}

export async function runIngestion(
  sources: DataSourceAdapter[],
  trigger: RunTrigger = { triggeredBy: "manual" },
) {
  const supabase = buildAdminClient();
  if (!supabase) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  for (const source of sources) {
    let run;

    try {
      run = await startRun(supabase, source.name, trigger);
    } catch (err) {
      // No run row exists, so there is nothing to mark failed. Report and carry on
      // to the next source rather than taking the whole job down.
      source.onError(err as Error);
      continue;
    }

    // Tracked out here so the failure path reports what actually happened rather
    // than zeros: a source can fetch 1000 records and then fail on the write.
    const counts: RunCounts = {
      fetched: 0,
      inserted: 0,
      skipped: 0,
      failed: 0,
    };

    try {
      const { records, truncated } = await source.fetch();
      counts.fetched = records.length;

      const { inserted, updated, skipped } = await storeRawRecords(
        supabase,
        run.id,
        source.name,
        records,
      );
      counts.inserted = inserted;
      counts.skipped = skipped;

      await finishRun(
        supabase,
        run.id,
        truncated ? "partial" : "completed",
        counts,
      );

      console.log(
        `[${source.name}] fetched ${counts.fetched}, written ${inserted} ` +
          `(${inserted - updated} new, ${updated} changed), skipped ${skipped}` +
          `${truncated ? " — partial, hit the source's result ceiling" : ""}`,
      );
    } catch (err) {
      counts.failed = counts.fetched - counts.inserted - counts.skipped;
      source.onError(err as Error);

      try {
        await finishRun(
          supabase,
          run.id,
          "failed",
          counts,
          err instanceof Error ? err.message : String(err),
        );
      } catch (finishErr) {
        // Marking the run failed itself failed. The run row is left 'running' and
        // will need reconciling, but the remaining sources still get their turn.
        source.onError(finishErr as Error);
      }
    }
  }
}
