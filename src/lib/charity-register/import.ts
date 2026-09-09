import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { applyDataHandling, type DataHandlingPolicy } from "../ingestion/apply-data-handling.ts";
import { hashPayload } from "../ingestion/checksum.ts";
import type { CharityRegisterFilters } from "./filters.ts";
import { selectCharities, type RegisterCharity } from "./sqlite.ts";

/**
 * Copies the charities a filter set selects out of the register file and into
 * `raw_source_records`, ready for the existing promote path.
 *
 * This is the moment a charity stops being a row in a public directory and
 * becomes a client. Everything after it — standardising, the client-criteria
 * check, duplicate detection, financial periods — is the unchanged
 * `charity_commission_bulk` promote path. No second definition of what an
 * organisation is.
 *
 * ── Where the data-handling rules run (F246/F247) ──
 *
 * Here, not in the file. The register file is a local mirror of something the
 * regulator publishes to the world; the rules govern what enters *our* store,
 * which is this write. Doing it here also means the active policy is read at
 * import time rather than baked into an artefact built weeks earlier, and the
 * CI job that builds the file needs no database credentials at all.
 *
 * ── Why the payload is rebuilt in the register's own field names ──
 *
 * `standardizeCharityCommissionBulkRecord` and `buildFinancialPeriodsFromBulk`
 * read `charity_contact_address1` and `income_donations_and_legacies`. The file
 * stores those under tidier names. Converting back here keeps one standardiser
 * with one vocabulary, instead of teaching it a second.
 */

/** Stored column -> the extract field name the standardiser reads. */
const RETURN_COLUMN_TO_EXTRACT: Readonly<Record<string, string>> = {
  total_income: "income_total_income_and_endowments",
  total_expenditure: "expenditure_total",
  income_donations_legacies: "income_donations_and_legacies",
  income_charitable_activities: "income_charitable_activities",
  income_other_trading: "income_other_trading_activities",
  income_investment: "income_investments",
  income_endowments: "income_endowments",
  income_other: "income_other",
  income_govt_grants: "income_from_government_grants",
  income_govt_contracts: "income_from_government_contracts",
  expenditure_charitable_activities: "expenditure_charitable_expenditure",
  expenditure_raising_funds: "expenditure_raising_funds",
  expenditure_governance: "expenditure_governance",
  expenditure_grants_institutions: "expenditure_grants_institution",
  expenditure_investment_management: "expenditure_investment_management",
  expenditure_other: "expenditure_other",
  filing_date: "ar_received_date",
  count_employees: "count_employees",
  count_volunteers: "count_volunteers",
  receives_govt_grants: "charity_receives_govt_funding_grants",
  receives_govt_contracts: "charity_receives_govt_funding_contracts",
  count_govt_grants: "count_govt_grants",
  count_govt_contracts: "count_govt_contracts",
};

/** One stored return, in the shape the standardiser expects. */
export function toExtractReturn(stored: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    organisation_number: stored.organisation_number,
    fin_period_start_date: stored.period_start,
    fin_period_end_date: stored.period_end,
  };
  for (const [column, field] of Object.entries(RETURN_COLUMN_TO_EXTRACT)) {
    const value = stored[column];
    // Omitted rather than written as null: null changes nothing downstream, and
    // a lean payload is readable when someone opens a raw record to see what
    // actually arrived.
    if (value !== null && value !== undefined) out[field] = value;
  }
  return out;
}

/** Classifications and areas of operation the register gives one charity. */
export type CharityLabels = { what: string[]; areas: string[] };

/** The payload the `charity_commission_bulk` promote path reads. */
export function toRawPayload(
  charity: RegisterCharity,
  labels: CharityLabels,
  returns: Record<string, unknown>[],
): Record<string, unknown> {
  let addressLines: string[] = [];
  try {
    const parsed = charity.address_lines ? JSON.parse(charity.address_lines) : [];
    if (Array.isArray(parsed)) addressLines = parsed.map(String);
  } catch {
    // A malformed address costs this charity its address, not the whole import.
  }
  const [line1, line2, line3, line4, line5] = addressLines;

  return {
    charity: {
      organisation_number: charity.organisation_number,
      registered_charity_number: charity.registered_charity_number,
      charity_name: charity.charity_name,
      // The file holds only registered charities, so this is a constant rather
      // than a stored column — see the build script's second pass.
      charity_registration_status: "Registered",
      charity_reporting_status: charity.reporting_status,
      date_of_registration: charity.date_of_registration,
      charity_contact_address1: line1 ?? null,
      charity_contact_address2: line2 ?? null,
      charity_contact_address3: line3 ?? null,
      charity_contact_address4: line4 ?? null,
      charity_contact_address5: line5 ?? null,
      charity_contact_postcode: charity.postcode,
      charity_contact_email: charity.contact_email,
      charity_contact_web: charity.contact_website,
      charity_company_registration_number: charity.company_number,
      charity_is_cio: charity.is_cio === 1,
      charity_activities: charity.activities,
    },
    annual_returns: returns.map(toExtractReturn),
    // Every classification the register gives this charity, not the subset the
    // filter matched. The record should describe the charity, not the query that
    // found it — a preset narrowing to one cause must not make the stored record
    // claim the charity only does that one thing.
    matched_classifications: labels.what,
    matched_areas: labels.areas,
  };
}

export type ImportOutcome = {
  /** Charities the filter selected. */
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
 * charity already held with an identical payload is skipped, so re-running a
 * saved filter set is safe and cheap.
 */
export async function importSelection(
  supabase: SupabaseClient,
  filters: CharityRegisterFilters,
  ingestionRunId: string,
  policy: DataHandlingPolicy,
  limit?: number,
  labelsFor?: (organisationNumber: number) => CharityLabels,
): Promise<ImportOutcome | { error: string }> {
  const selected = selectCharities(filters, limit);
  if (selected.length === 0) return { selected: 0, written: 0, unchanged: 0 };

  const numbers = selected.map((row) => row.charity.organisation_number);

  // What is already held, so an unchanged charity is not rewritten. Sliced well
  // under PostgREST's row cap so a full page can never be a truncated one.
  const existing = new Map<string, { checksum: string; ingestion_attempt: number }>();
  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    const slice = numbers.slice(i, i + BATCH_SIZE).map(String);
    const { data, error } = await supabase
      .from("raw_source_records")
      .select("source_record_id, checksum, ingestion_attempt")
      .eq("record_source", "charity_commission_bulk")
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

  for (const { charity, returns } of selected) {
    const id = String(charity.organisation_number);
    const payload = toRawPayload(
      charity,
      labelsFor?.(charity.organisation_number) ?? { what: [], areas: [] },
      returns,
    );

    // F246/F247, before the checksum so the stored checksum describes what was
    // actually stored — tightening a rule then correctly re-imports the record
    // rather than skipping it as unchanged.
    const cleared = applyDataHandling(payload, "charity_commission_bulk", policy);
    const checksum = hashPayload(cleared.payload);
    const previous = existing.get(id);

    if (previous?.checksum === checksum) {
      outcome.unchanged += 1;
      continue;
    }

    batch.push({
      ingestion_run_id: ingestionRunId,
      record_source: "charity_commission_bulk",
      source_record_id: id,
      raw_payload: cleared.payload,
      checksum,
      source_country: "GB",
      source_registry_name: "Charity Commission for England and Wales",
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
