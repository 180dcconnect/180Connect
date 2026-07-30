// src/lib/ingestion/runner.ts
// This file contains the logic for running the ingestion process. It fetches data from various sources and stores it in the database.

import { createClient } from "@supabase/supabase-js";
import type { DataSourceAdapter, CommonRecord } from "./type.js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase URL or service role key is not configured.");
  }

  return createClient(url, key);
}

async function startRun(source: string) {
  const supabase = getServiceClient();

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

// runner.ts continued

async function insertRawRecords(
  runId: string,
  source: string,
  records: CommonRecord[],
) {
  const supabase = getServiceClient();

  const rows = records.map((record) => ({
    ingestion_run_id: runId,
    record_source: source,
    source_record_id: record.source_record_id,
    raw_payload: record.raw_payload,
    checksum: hashPayload(record.raw_payload),
    source_country: record.source_country ?? null,
    source_registry_name: record.source_registry_name ?? null,
  }));

  const { error } = await supabase.from("raw_source_records").insert(rows);
  if (error) throw error;
}

function hashPayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 31 + json.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

async function finishRun(
  runId: string,
  status: string,
  counts: { fetched: number; inserted: number; failed: number },
) {
  const supabase = getServiceClient();

  const { error } = await supabase
    .from("ingestion_runs")
    .update({
      job_status: status,
      completed_at: new Date().toISOString(),
      records_fetched: counts.fetched,
      records_inserted: counts.inserted,
      records_failed: counts.failed,
    })
    .eq("id", runId);

  if (error) throw error;
}

export async function runIngestion(sources: DataSourceAdapter[]) {
  for (const source of sources) {
    const run = await startRun(source.name);

    try {
      const records = await source.fetch();
      await insertRawRecords(run.id, source.name, records);
      await finishRun(run.id, "completed", {
        fetched: records.length,
        inserted: records.length,
        failed: 0,
      });
      console.log(`[${source.name}] inserted ${records.length} records`);
    } catch (err) {
      source.onError(err as Error);
      await finishRun(run.id, "failed", { fetched: 0, inserted: 0, failed: 0 });
    }
  }
}
