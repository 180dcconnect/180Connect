// Puts the fetched page into the raw layer (F037).
//
// A URL import is external data entering the platform, and the data handling policy
// (docs/data-handling-policy.md §2) commits to that happening at one place —
// RAW_SOURCE_RECORDS — so retention, the field-level rules and any later audit see
// every source alike. A page kept only in the draft it produced would be outside all
// three, and "where did this value come from" would be unanswerable a month later.
//
// The payload is the response as received, not the extraction. That is what the
// table's own comment requires ("stored exactly as received, untouched"), and it is
// what makes the record evidence: a CAM disputing an imported value can be shown the
// markup it was read from. The extraction is a derivation and lives on the draft.
//
// Registry responses fetched during the same import are deliberately NOT written
// here. Those numbers are re-fetchable from an authoritative API at any time, and
// writing them out-of-band would collide with the scheduled importer's own
// checksum and ingestion_attempt bookkeeping on the same (record_source,
// source_record_id) key.

import { createAdminClient } from "../supabase/admin.ts";
import { hashPayload } from "../ingestion/checksum.ts";
import type { FetchedPage } from "./fetch-page.ts";

export type StoredPage = { rawRecordId: string } | { rawRecordId: null; reason: string };

/**
 * The stored shape. Flat and self-describing: someone reading this row in a year
 * should not need this file to understand what they are looking at.
 */
function payloadFor(page: FetchedPage, fetchedAt: string) {
  return {
    requested_url: page.requestedUrl,
    final_url: page.finalUrl,
    fetched_at: fetchedAt,
    content_type: page.contentType,
    truncated: page.truncated,
    html: page.html,
  };
}

/**
 * Writes one ingestion run and one raw record for this fetch.
 *
 * The run row is not ceremony: RAW_SOURCE_RECORDS.ingestion_run_id is NOT NULL, and
 * a run per import is what makes the admin import-status screen able to show manual
 * URL imports beside the scheduled ones without a second concept.
 *
 * Returns a reason instead of throwing when the service-role key is absent. The key
 * is optional on a developer machine (see admin-client-factory), and an import that
 * cannot store its evidence should still let the CAM review what was found — with
 * the draft recording that no raw record backs it.
 */
export async function storeFetchedPage(
  page: FetchedPage,
  actorUserId: string,
): Promise<StoredPage> {
  const supabase = createAdminClient();
  if (!supabase) {
    return { rawRecordId: null, reason: "service role key is not configured" };
  }

  const fetchedAt = new Date().toISOString();
  const payload = payloadFor(page, fetchedAt);

  const { data: run, error: runError } = await supabase
    .from("ingestion_runs")
    .insert({
      api_source: "website",
      triggered_by: "manual",
      triggered_by_user_id: actorUserId,
      job_status: "running",
    })
    .select("id")
    .single();
  if (runError) throw runError;

  const checksum = hashPayload(payload);
  const { data: existing } = await supabase
    .from("raw_source_records")
    .select("id, checksum, ingestion_attempt")
    .eq("record_source", "website")
    .eq("source_record_id", page.finalUrl)
    .maybeSingle();

  const isUnchanged = existing && existing.checksum === checksum;
  const nextAttempt = existing
    ? (isUnchanged ? existing.ingestion_attempt : existing.ingestion_attempt + 1)
    : 1;

  // The URL is the identity of a website record, so a re-import of the same page
  // updates the row the first import wrote rather than accumulating copies.
  const { data: record, error: recordError } = await supabase
    .from("raw_source_records")
    .upsert(
      {
        ingestion_run_id: run.id,
        record_source: "website",
        source_record_id: page.finalUrl,
        raw_payload: payload,
        checksum,
        source_country: null,
        source_registry_name: null,
        processing_status: "pending",
        ingestion_attempt: nextAttempt,
      },
      { onConflict: "record_source,source_record_id" },
    )
    .select("id")
    .single();

  const { error: updateError } = await supabase
    .from("ingestion_runs")
    .update({
      job_status: recordError ? "failed" : "completed",
      completed_at: new Date().toISOString(),
      records_fetched: 1,
      records_inserted: recordError ? 0 : (isUnchanged ? 0 : 1),
      records_skipped: isUnchanged ? 1 : 0,
      records_failed: recordError ? 1 : 0,
      error_message: recordError ? recordError.message : null,
    })
    .eq("id", run.id);

  if (recordError) throw recordError;
  if (updateError) throw updateError;
  return { rawRecordId: record.id as string };
}
