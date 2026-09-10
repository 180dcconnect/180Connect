import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { applyDataHandling, type DataHandlingPolicy } from "../ingestion/apply-data-handling.ts";
import { hashPayload } from "../ingestion/checksum.ts";
import type { CompanyRegisterFilters } from "./filters.ts";
import { selectCompanies, type RegisterCompany } from "./sqlite.ts";

/**
 * Copies the companies a filter set selects out of the register file and into
 * `raw_source_records`, ready for the existing promote path.
 *
 * The twin of src/lib/charity-register/import.ts: this is the moment a
 * company stops being a row in a public directory and becomes a client.
 * Everything after it — standardising, the client-criteria check (with the
 * Tier A/B strong-evidence bypass), duplicate detection — is the unchanged
 * `companies_house` promote path. No second definition of what an
 * organisation is.
 *
 * ── Where the data-handling rules run (F246/F247) ──
 *
 * Here, not in the file — the same contract as every other ingestion path,
 * applied before the checksum so the stored checksum describes what was
 * actually stored. The product carries no contact details, so in practice
 * this is a no-op; it runs anyway, so a future file with richer fields is
 * covered without a code change, and the import fails closed if the rules
 * cannot be read.
 *
 * ── Why the payload speaks the API's field names ──
 *
 * `standardizeCompaniesHouseRecord` reads `company_name`, `sic_codes` and
 * the `registered_office_address` object — the file stores those under
 * tidier column names. Converting here keeps one standardiser with one
 * vocabulary, shared with the single-lookup and status-recheck paths that
 * already write API-shaped payloads.
 */

/** The payload the `companies_house` promote path reads. */
export function toRawPayload(
  company: RegisterCompany,
  sicCodes: string[],
): Record<string, unknown> {
  const address: Record<string, string> = {};
  if (company.address_line_1) address.address_line_1 = company.address_line_1;
  if (company.town) address.locality = company.town;
  if (company.postcode) address.postal_code = company.postcode;

  const payload: Record<string, unknown> = {
    company_name: company.name,
    company_type: company.cat_slug,
    sic_codes: sicCodes,
    company_status: company.status_norm,
    registered_office_address: address,
  };
  // CICs arrive with the file's own category flag rather than the API's
  // subtype (the file does not publish underlying legal forms for CICs).
  // The tier classifier learns this value alongside the subtype check, so a
  // file-sourced CIC keeps its strong-evidence bypass.
  if (company.is_cic === 1) {
    payload.company_subtype = "community-interest-company";
  }
  return payload;
}

export type ImportOutcome = {
  /** Companies the filter selected. */
  selected: number;
  /** Rows written — new, or changed since last time. */
  written: number;
  /** Already held with an identical payload, so left alone. */
  unchanged: number;
};

const BATCH_SIZE = 500;
/** PostgREST caps a response at this and does not say when it truncated one. */
const PAGE_LIMIT = 1_000;

/**
 * Runs the import.
 *
 * Idempotent by checksum, the same contract the ingestion runner follows: a
 * company already held with an identical payload is skipped, so re-running a
 * saved filter set is safe and cheap.
 */
export async function importSelection(
  supabase: SupabaseClient,
  filters: CompanyRegisterFilters,
  ingestionRunId: string,
  policy: DataHandlingPolicy,
  limit?: number,
): Promise<ImportOutcome | { error: string }> {
  const selected = selectCompanies(filters, limit);
  if (selected.length === 0) return { selected: 0, written: 0, unchanged: 0 };

  const numbers = selected.map((row) => row.company.number);

  // What is already held, so an unchanged company is not rewritten. Sliced
  // well under PostgREST's row cap so a full page can never be a truncated one.
  const existing = new Map<string, { checksum: string; ingestion_attempt: number }>();
  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    const slice = numbers.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("raw_source_records")
      .select("source_record_id, checksum, ingestion_attempt")
      .eq("record_source", "companies_house")
      .in("source_record_id", slice)
      .limit(PAGE_LIMIT);
    if (error) return { error: error.message };
    for (const row of data ?? []) {
      existing.set(row.source_record_id, {
        checksum: row.checksum,
        ingestion_attempt: row.ingestion_attempt,
      });
    }
  }

  const outcome: ImportOutcome = { selected: selected.length, written: 0, unchanged: 0 };
  let batch: Record<string, unknown>[] = [];

  const flush = async (): Promise<{ error: string } | null> => {
    if (batch.length === 0) return null;
    const { error } = await supabase
      .from("raw_source_records")
      .upsert(batch, { onConflict: "record_source,source_record_id" });
    if (error) return { error: error.message };
    outcome.written += batch.length;
    batch = [];
    return null;
  };

  for (const { company, sicCodes } of selected) {
    const id = company.number;
    const payload = toRawPayload(company, sicCodes);

    // F246/F247, before the checksum so the stored checksum describes what was
    // actually stored — tightening a rule then correctly re-imports the record
    // rather than skipping it as unchanged.
    const cleared = applyDataHandling(payload, "companies_house", policy);
    const checksum = hashPayload(cleared.payload);
    const previous = existing.get(id);

    if (previous?.checksum === checksum) {
      outcome.unchanged += 1;
      continue;
    }

    batch.push({
      ingestion_run_id: ingestionRunId,
      record_source: "companies_house",
      source_record_id: id,
      raw_payload: cleared.payload,
      checksum,
      source_country: "GB",
      source_registry_name: "Companies House",
      ingestion_attempt: previous ? previous.ingestion_attempt + 1 : 1,
      excluded_fields: cleared.excludedFields,
      rule_version_applied: policy.version,
    });

    if (batch.length >= BATCH_SIZE) {
      const failure = await flush();
      if (failure) return failure;
    }
  }

  const failure = await flush();
  if (failure) return failure;

  return outcome;
}
