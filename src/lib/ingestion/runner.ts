// src/lib/ingestion/runner.ts
// This file contains the logic for running the ingestion process. It fetches data from various sources and stores it in the database.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DataSourceAdapter, CommonRecord } from "./type";
import { buildAdminClient } from "../supabase/admin-client-factory";
import { createHash } from "node:crypto";

async function startRun(supabase: SupabaseClient, source: string) {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .insert({
      api_source: source,
      triggered_by: "manual",
      job_status: "running",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function insertRawRecords(
  supabase: SupabaseClient,
  runId: string,
  source: string,
  records: CommonRecord[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const record of records) {
    const checksum = hashPayload(record.raw_payload);

    const { data: existing } = await supabase
      .from("raw_source_records")
      .select("id, checksum, ingestion_attempt")
      .eq("record_source", source)
      .eq("source_record_id", record.source_record_id)
      .maybeSingle();

    if (existing && existing.checksum === checksum) {
      skipped++;
      continue;
    }

    const row = {
      ingestion_run_id: runId,
      record_source: source,
      source_record_id: record.source_record_id,
      raw_payload: record.raw_payload,
      checksum,
      source_country: record.source_country ?? null,
      source_registry_name: record.source_registry_name ?? null,
      ingestion_attempt: existing ? existing.ingestion_attempt + 1 : 1,
    };

    const { error } = await supabase
      .from("raw_source_records")
      .upsert(row, { onConflict: "record_source,source_record_id" });

    if (error) throw error;
    inserted++;
  }

  return { inserted, skipped };
}

function hashPayload(payload: unknown): string {
  const stable = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash("sha256").update(stable).digest("hex");
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  status: string,
  counts: {
    fetched: number;
    inserted: number;
    skipped: number;
    failed: number;
  },
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

export async function runIngestion(sources: DataSourceAdapter[]) {
  const supabase = buildAdminClient();
  if (!supabase) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  for (const source of sources) {
    let run;

    try {
      run = await startRun(supabase, source.name);
    } catch (err) {
      source.onError(err as Error);
      continue;
    }

    try {
      const records = await source.fetch();
      const wasTruncated =
        (records as CommonRecord[] & { truncated?: boolean }).truncated ??
        false;
      const { inserted, skipped } = await insertRawRecords(
        supabase,
        run.id,
        source.name,
        records,
      );
      await finishRun(
        supabase,
        run.id,
        wasTruncated ? "partial" : "completed",
        {
          fetched: records.length,
          inserted,
          skipped,
          failed: 0,
        },
      );
      console.log(
        `[${source.name}] fetched ${records.length}, inserted ${inserted}, skipped ${skipped}${wasTruncated ? " (partial — hit source ceiling)" : ""}`,
      );
    } catch (err) {
      source.onError(err as Error);
      await finishRun(
        supabase,
        run.id,
        "failed",
        { fetched: 0, inserted: 0, skipped: 0, failed: 0 },
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
