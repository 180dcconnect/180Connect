// The Supabase implementation of IngestionStore (F038).
//
// All the PostgREST detail lives here so runner.ts holds only the decisions —
// what counts as skipped, when a run is partial, what happens when a source throws.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAdminClient } from "../supabase/admin-client-factory.ts";
import type {
  DataSourceName,
  IngestionStore,
  JobStatus,
  RawRecordRow,
  RunCounts,
  RunTrigger,
} from "./type.ts";

/**
 * Rows per round trip, both when reading existing checksums and when upserting.
 *
 * A per-record round trip is two queries per record — roughly 2400 sequential
 * queries for one Companies House run. This makes it ceil(n / 500) of each.
 */
const BATCH_SIZE = 500;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function createSupabaseIngestionStore(
  supabase: SupabaseClient,
): IngestionStore {
  return {
    async startRun(source: DataSourceName, trigger: RunTrigger) {
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
      return { id: data.id as string };
    },

    async loadChecksums(source: DataSourceName, sourceRecordIds: string[]) {
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
    },

    async writeRecords(rows: RawRecordRow[]) {
      for (const batch of chunk(rows, BATCH_SIZE)) {
        const { error } = await supabase
          .from("raw_source_records")
          .upsert(batch, { onConflict: "record_source,source_record_id" });

        if (error) throw error;
      }
    },

    async finishRun(
      runId: string,
      status: JobStatus,
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
    },
  };
}

/** The store the scripts and the scheduled job use. Null when the key is absent. */
export function createDefaultIngestionStore(): IngestionStore | null {
  const supabase = buildAdminClient();
  return supabase ? createSupabaseIngestionStore(supabase) : null;
}
