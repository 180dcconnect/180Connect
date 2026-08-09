// F041/F260: promotes pending raw_source_records into organisations, using a
// source-specific standardize function (charity-commission.ts,
// companies-house.ts) to map fields. One promote function per source
// (promotePendingCharityCommissionRecords, promotePendingCompaniesHouseRecords)
// sharing the loop in promotePendingRecords below — the source-specific
// difference is only which mapper runs and which record_source to filter on.
//
// Modelled on runner.ts's dependency-injection pattern (an injectable Store
// interface, a real Supabase-backed default implementation, a fake for
// tests) so this is testable without touching a real database.
//
// Explicitly NOT done here, and flagged rather than silently skipped:
//   - Cross-source deduplication (F042). Every pending record becomes a new
//     organisations row; there is no check for "does a charity with this
//     name/number already exist from another source". Per this team's
//     confirmed policy (a dependency ticket doesn't block downstream work),
//     this is built now and flagged, not blocked on F042 existing first.
//   - Conflict flagging (F048) — same.
//
// processing_status semantics used here (per raw_source_records' check
// constraint: pending/validated/matched/rejected/error):
//   - 'validated': successfully mapped and inserted into organisations.
//     TODO: 'matched' might be the semantically correct status once F042
//     exists and this row's charity was matched against an *existing* org
//     rather than creating a new one — worth revisiting once F042 is built,
//     since right now every success always creates a new row, never matches.
//   - 'rejected': mapped, but failed minimal validation (empty legal_name —
//     organisations.legal_name is NOT NULL, and an empty string technically
//     satisfies that constraint but is not a usable record).
//   - 'error': the insert itself failed (e.g. a database error).

import { buildAdminClient } from "../supabase/admin-client-factory.ts";
import { checkClientCriteria, type ClientCriteriaResult } from "../client-criteria.ts";
import { reportError } from "../error-logging.ts";
import { checkWebsiteReachability } from "../website-reachability.ts";
import type { WebsiteStatus } from "../website-validation.ts";
import {
  standardizeCharityCommissionRecord,
  type RawCharityCommissionRecord,
} from "./charity-commission.ts";
import { standardizeCompaniesHouseRecord } from "./companies-house.ts";
import type { StandardOrganisation } from "./types.ts";



export type PendingRecord = {
  id: string; // raw_source_records.id
  // Left as unknown, not a specific Raw*Record type: this same loader serves
  // every source (charity_commission, companies_house, ...), and each one's
  // raw_payload shape only means anything in the context of that source's own
  // standardize function, which is where it gets cast and validated.
  raw_payload: unknown;
};

export type PromoteCounts = {
  read: number;
  inserted: number;
  // Total excluded from the active client list (invalidData + needsReview +
  // doesNotMeet) — kept as one field for callers that only want the headline
  // number; the breakdown below exists so a garbage-data spike (invalidData)
  // doesn't hide behind a healthy batch of F047 review candidates, or vice versa.
  rejected: number;
  invalidData: number;
  needsReview: number;
  doesNotMeet: number;
  failed: number;
};

function newCounts(read: number): PromoteCounts {
  return {
    read,
    inserted: 0,
    rejected: 0,
    invalidData: 0,
    needsReview: 0,
    doesNotMeet: 0,
    failed: 0,
  };
}

const WEBSITE_VALIDATION_CONCURRENCY = 5;

/**
 * Everything promotePending*Records functions need from the database,
 * behind an interface — same reasoning as runner.ts's IngestionStore: the
 * decision logic (map, validate, decide a status) is testable without a
 * database; createDefaultOrganisationWriteStore is the real implementation.
 */
export interface OrganisationWriteStore {
  loadPendingRecords(source: string): Promise<PendingRecord[]>;
  insertOrganisation(
    org: StandardOrganisation,
  ): Promise<{ id: string } | { error: string }>;
  markRecordStatus(
    rawRecordId: string,
    status: "validated" | "rejected" | "error",
    matchedOrganisationId?: string,
  ): Promise<void>;
  recordCriteriaOutcome(
    rawRecordId: string,
    result: ClientCriteriaResult,
    organisationType: string,
  ): Promise<void>;
}

export function createDefaultOrganisationWriteStore(): OrganisationWriteStore | null {
  const supabase = buildAdminClient();
  if (!supabase) return null;

  return {
    async loadPendingRecords(source) {
      const { data, error } = await supabase
        .from("raw_source_records")
        .select("id, raw_payload")
        .eq("record_source", source)
        .eq("processing_status", "pending");

      if (error) throw error;
      return (data ?? []) as PendingRecord[];
    },

    async insertOrganisation(org) {
      const { data, error } = await supabase
        .from("organisations")
        .insert(org)
        .select("id")
        .single();

      if (error) return { error: error.message };
      return { id: data.id };
    },

    async markRecordStatus(rawRecordId, status, matchedOrganisationId) {
      const { error } = await supabase
        .from("raw_source_records")
        .update({
          processing_status: status,
          matched_organisation_id: matchedOrganisationId ?? null,
        })
        .eq("id", rawRecordId);

      if (error) throw error;
    },

    async recordCriteriaOutcome(rawRecordId, result, organisationType) {
      const { error } = await supabase.rpc("record_client_criteria_outcome", {
        p_raw_source_record_id: rawRecordId,
        p_outcome: result.outcome,
        p_organisation_type: organisationType,
        p_reasons: result.reasons.join(" "),
        p_priority: result.priority,
        p_healthcare_aligned: result.healthcareAligned,
      });
      if (error) throw error;
    },
  };
}

/** A record is usable if it at least has a non-empty legal_name. */
function isUsable(org: StandardOrganisation): boolean {
  return org.legal_name.trim() !== "";
}

function buildCriteriaInput(
  org: StandardOrganisation,
): Parameters<typeof checkClientCriteria>[0] {
  return {
    organisationType: org.organisation_type,
    city: org.city,
    postcode: org.postcode,
    countryCode: org.country_code,
    geographicReach: org.geographic_reach,
    // sector/mission (F047's healthcare-alignment signal) live on
    // ENRICHMENT_RESULTS (Data Model tab 04), a later pipeline stage that
    // doesn't run at import time — not available on StandardOrganisation, so
    // healthcareAligned is always false for freshly imported records until
    // that stage exists. Not this layer's gap to fix: adding an import-time
    // field here would mean guessing at data the source doesn't provide.
  };
}

async function markInvalidRecord(
  store: OrganisationWriteStore,
  counts: PromoteCounts,
  record: PendingRecord,
): Promise<void> {
  await store.markRecordStatus(record.id, "rejected");
  counts.invalidData++;
  counts.rejected++;
}

/**
 * Runs the F047 client criteria check for one already-usable record. Records
 * the outcome (with an audit trail — see record_client_criteria_outcome) and
 * increments the matching counter when it doesn't meet, shared by every
 * promotePending*Records loop so a future change to this step doesn't need
 * to be applied in more than one place.
 */
async function passesClientCriteria(
  store: OrganisationWriteStore,
  counts: PromoteCounts,
  record: PendingRecord,
  org: StandardOrganisation,
  criteria: ClientCriteriaResult,
): Promise<boolean> {
  if (criteria.outcome === "meets") return true;

  // priority/healthcareAligned are passed through to the audit trail (see
  // record_client_criteria_outcome's detail jsonb) but "meets" records below
  // have nowhere to persist them — ORGANISATIONS has no column for either
  // (Data Model tab 04); adding one is a schema decision for the Data Model
  // spreadsheet (AGENTS.md), not something this layer can invent.
  await store.recordCriteriaOutcome(record.id, criteria, org.organisation_type);
  if (criteria.outcome === "needs_review") counts.needsReview++;
  else counts.doesNotMeet++;
  counts.rejected++;
  return false;
}

/**
 * Shared loop behind every promotePending*Records function: load a source's
 * pending records, map each with that source's standardize function, and
 * insert or reject/error accordingly. The only thing that varies per source
 * is which record_source to filter on and which mapper to run.
 *
 * Note: website validation (F046) is Charity Commission-specific and is
 * handled in promotePendingCharityCommissionRecords directly, since
 * Companies House records carry no website or email data.
 */
async function promotePendingRecords<TRaw>(
  store: OrganisationWriteStore,
  source: string,
  standardize: (raw: TRaw) => StandardOrganisation,
  criteriaCheck: (input: Parameters<typeof checkClientCriteria>[0]) => ClientCriteriaResult,
): Promise<PromoteCounts> {
  const pending = await store.loadPendingRecords(source);
  const counts = newCounts(pending.length);

  for (const record of pending) {
    let org: StandardOrganisation;
    try {
      org = standardize(record.raw_payload as TRaw);
    } catch (error) {
      // raw_payload is untyped JSON from the database. A legacy or malformed
      // record that doesn't match this source's expected shape can throw inside
      // the mapper. Catch it here so one bad record doesn't crash the whole batch.
      await reportError(error instanceof Error ? error : new Error(String(error)), {
        operation: `standardize.${source}.promote`,
        rawRecordId: record.id,
      });
      await store.markRecordStatus(record.id, "error");
      counts.failed++;
      continue;
    }

    if (!isUsable(org)) {
      await markInvalidRecord(store, counts, record);
      continue;
    }

    const criteria = criteriaCheck(buildCriteriaInput(org));
    if (!(await passesClientCriteria(store, counts, record, org, criteria))) {
      continue;
    }

    const result = await store.insertOrganisation(org);
    if ("error" in result) {
      await reportError(new Error(result.error), {
        operation: `standardize.${source}.promote`,
        rawRecordId: record.id,
      });
      await store.markRecordStatus(record.id, "error");
      counts.failed++;
      continue;
    }

    await store.markRecordStatus(record.id, "validated", result.id);
    counts.inserted++;
  }

  return counts;
}

function requireStore(
  store: OrganisationWriteStore | null,
): asserts store is OrganisationWriteStore {
  if (!store) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
}

export async function promotePendingCharityCommissionRecords(
  store: OrganisationWriteStore | null = createDefaultOrganisationWriteStore(),
  checkWebsite: (value: string) => Promise<WebsiteStatus> = checkWebsiteReachability,
  criteriaCheck: (input: Parameters<typeof checkClientCriteria>[0]) => ClientCriteriaResult = checkClientCriteria,
): Promise<PromoteCounts> {
  requireStore(store);

  const pending = await store.loadPendingRecords("charity_commission");
  const counts = newCounts(pending.length);

  // Criteria checked once per record up front and carried through — it's a
  // cheap pure function, but the website-check filter below and the reject/
  // insert loop both need its result, and it must run exactly once per record
  // (an injected criteriaCheck may be a test spy asserting call count).
  const prepared = pending.map((record) => {
    const org = standardizeCharityCommissionRecord(record.raw_payload as RawCharityCommissionRecord);
    const criteria = isUsable(org) ? criteriaCheck(buildCriteriaInput(org)) : null;
    return { record, org, criteria };
  });

  // Website reachability (F046) only matters for records about to become an
  // active client — checking it before the criteria filter would fire live
  // HTTP requests for records that are about to be rejected anyway. Resolved
  // in small concurrent batches; database writes remain ordered below, while a
  // slow website cannot serially stall every import row.
  const toWebsiteCheck = prepared.filter(
    ({ org, criteria }) => criteria?.outcome === "meets" && org.website.trim(),
  );
  for (let start = 0; start < toWebsiteCheck.length; start += WEBSITE_VALIDATION_CONCURRENCY) {
    await Promise.all(
      toWebsiteCheck.slice(start, start + WEBSITE_VALIDATION_CONCURRENCY).map(async ({ record, org }) => {
        const website = await checkWebsite(org.website);
        if (website.status === "invalid" || website.status === "unreachable") {
          await reportError(new Error("Imported client website validation failed"), {
            operation: "standardize.charity_commission.website_validation",
            rawRecordId: record.id,
            websiteStatus: website.status,
          });
        }
      }),
    );
  }

  for (const { record, org, criteria } of prepared) {
    if (!isUsable(org)) {
      await markInvalidRecord(store, counts, record);
      continue;
    }

    // Keep the raw record out of the active client list while preserving the
    // distinct outcome and reasons in DATA_QUALITY_EVENTS for admin review.
    if (!(await passesClientCriteria(store, counts, record, org, criteria!))) {
      continue;
    }

    const result = await store.insertOrganisation(org);
    if ("error" in result) {
      await reportError(new Error(result.error), {
        operation: "standardize.charity_commission.promote",
        rawRecordId: record.id,
      });
      await store.markRecordStatus(record.id, "error");
      counts.failed++;
      continue;
    }

    await store.markRecordStatus(record.id, "validated", result.id);
    counts.inserted++;
  }

  return counts;
}

export async function promotePendingCompaniesHouseRecords(
  store: OrganisationWriteStore | null = createDefaultOrganisationWriteStore(),
  criteriaCheck: (input: Parameters<typeof checkClientCriteria>[0]) => ClientCriteriaResult = checkClientCriteria,
): Promise<PromoteCounts> {
  requireStore(store);
  return promotePendingRecords(
    store,
    "companies_house",
    standardizeCompaniesHouseRecord,
    criteriaCheck,
  );
}
