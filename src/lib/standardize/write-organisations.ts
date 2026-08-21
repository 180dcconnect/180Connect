// F041/F260/F262: promotes pending raw_source_records into organisations,
// using a source-specific standardize function (charity-commission.ts,
// companies-house.ts, find-that-charity.ts) to map fields. One bespoke
// promote function per source (promotePendingCharityCommissionRecords,
// promotePendingCompaniesHouseRecords, promotePendingFindThatCharityRecords)
// — each needs its own extra per-record step (website validation for charity
// commission; F047 source-confidence classification for companies house;
// match-confidence filtering for find that charity) that a single shared
// loop can't express without every source paying for every other source's
// extra step.
//
// Modelled on runner.ts's dependency-injection pattern (an injectable Store
// interface, a real Supabase-backed default implementation, a fake for
// tests) so this is testable without touching a real database.
//
// Explicitly NOT done here, and flagged rather than silently skipped:
//   - Conflict flagging (F048) — not built yet.
//
// F042 (cross-source deduplication) IS done here: before inserting, every
// candidate that passes its own source's checks is checked against existing
// organisations via findDuplicateMatch (src/lib/dedup/match-organisations.ts).
// A match is flagged in entity_match_candidates for admin review instead of
// being inserted as a second row. All three promotePending*Records functions
// below call the shared flagIfDuplicate for this, so dedup applies to every
// source — this matters most for find_that_charity: F034's adapter only ever
// reconciles a name that already came from another source, so without this,
// every successfully promoted find_that_charity record would be a
// near-guaranteed duplicate of an existing organisations row, not a maybe.
//
// processing_status semantics used here (per raw_source_records' check
// constraint: pending/validated/matched/rejected/error):
//   - 'validated': successfully mapped and inserted into organisations.
//   - 'matched': mapped, but findDuplicateMatch found an existing
//     organisation this record is probably a duplicate of — flagged in
//     entity_match_candidates rather than inserted. If an admin later dismisses
//     the flag (decide_duplicate_flag with p_confirmed = false), the row is
//     reset to 'pending' so the next run promotes it normally.
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
  findDuplicateMatch,
  type DuplicateMatch,
  type ExistingOrganisationForMatch,
} from "../dedup/match-organisations.ts";
import {
  standardizeCharityCommissionRecord,
  type RawCharityCommissionRecord,
} from "./charity-commission.ts";
import {
  classifyCompaniesHouseSourceConfidence,
  standardizeCompaniesHouseRecord,
  type RawCompaniesHouseRecord,
} from "./companies-house.ts";
import {
  isConfidentMatch,
  standardizeFindThatCharityRecord,
  type RawFindThatCharityRecord,
} from "./find-that-charity.ts";
import { sourcePriority } from "./source-priority.ts";
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
  flagged: number;
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
    flagged: 0,
    rejected: 0,
    invalidData: 0,
    needsReview: 0,
    doesNotMeet: 0,
    failed: 0,
  };
}

/**
 * Shared by every promotePending*Records function below: check a mapped,
 * criteria-passed candidate against existing organisations (loaded once per
 * run — see callers) and flag it in entity_match_candidates instead of
 * inserting a second row. Returns true if the record was flagged (caller
 * should skip insertion and move on).
 */
async function flagIfDuplicate(
  store: OrganisationWriteStore,
  counts: PromoteCounts,
  record: PendingRecord,
  org: StandardOrganisation,
  existingOrganisations: ExistingOrganisationForMatch[],
  source: string,
): Promise<boolean> {
  const dismissedOrganisationIds = await store.loadDismissedMatches(record.id);
  const match = findDuplicateMatch(
    { legal_name: org.legal_name, postcode: org.postcode },
    existingOrganisations,
    new Set(dismissedOrganisationIds),
  );
  if (!match) return false;

  const flagResult = await store.flagPotentialDuplicate({
    rawRecordId: record.id,
    matchedOrganisationId: match.organisationId,
    matchedOn: match.matchedOn,
    source,
    // The only fields this matcher actually compares — see match-organisations.ts.
    // StandardOrganisation carries no registration-number field, so this is the same
    // for both matchedOn branches; a real gap, not a shortcut (see migration header).
    matchFields: { legal_name: org.legal_name, postcode: org.postcode },
  });
  if ("error" in flagResult) {
    await reportError(new Error(flagResult.error), {
      operation: `standardize.${source}.flag_duplicate`,
      rawRecordId: record.id,
    });
    await store.markRecordStatus(record.id, "error");
    counts.failed++;
    return true;
  }

  await store.markRecordStatus(record.id, "matched", match.organisationId);
  counts.flagged++;
  return true;
}

const WEBSITE_VALIDATION_CONCURRENCY = 5;
const PAGE_SIZE = 1000;

// entity_match_candidates.match_method/match_score are placeholders this binary
// matcher approximates, not a computed confidence — see the migration header
// (20260809150000_create_entity_match_candidates.sql) for the full reasoning.
const MATCH_METHOD_BY_MATCHED_ON: Record<DuplicateMatch["matchedOn"], string> = {
  registration_number: "exact_charity_number",
  name_and_postcode: "fuzzy_name",
};
const MATCH_SCORE_BY_MATCHED_ON: Record<DuplicateMatch["matchedOn"], number> = {
  registration_number: 1.0,
  name_and_postcode: 0.7,
};

// entity_match_candidates.source_priority is NOT NULL; lower = higher priority.
// The ranking itself now lives in standardize/source-priority.ts, because F048
// resolves field conflicts with the same rule and the two must not drift.

/**
 * Repeatedly calls fetchPage(from, to) until a page comes back shorter than
 * PAGE_SIZE, concatenating every row. Exists because PostgREST (Supabase's
 * query layer) caps an unbounded .select() at 1000 rows by default —
 * without paging, a caller silently stops seeing rows past row 1000 once a
 * table grows past that, and unlike a batch-scoped bug, that never
 * self-corrects on a later run. fetchPage is injected (rather than this
 * function taking a Supabase query builder directly) so it's testable with
 * a plain fake, same as everything else in this file.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Everything promotePending*Records functions need from the database,
 * behind an interface — same reasoning as runner.ts's IngestionStore: the
 * decision logic (map, validate, decide a status) is testable without a
 * database; createDefaultOrganisationWriteStore is the real implementation.
 */
export interface OrganisationWriteStore {
  loadPendingRecords(source: string): Promise<PendingRecord[]>;
  /** Every existing organisation findDuplicateMatch can compare candidates against. */
  loadExistingOrganisationsForMatching(): Promise<ExistingOrganisationForMatch[]>;
  /**
   * Organisation ids an admin has already confirmed this specific raw record is NOT
   * a duplicate of (decide_duplicate_flag, p_confirmed = false). Passed to
   * findDuplicateMatch so a dismissed flag doesn't get re-raised every run.
   */
  loadDismissedMatches(rawRecordId: string): Promise<string[]>;
  insertOrganisation(
    org: StandardOrganisation,
  ): Promise<{ id: string } | { error: string }>;
  flagPotentialDuplicate(input: {
    rawRecordId: string;
    matchedOrganisationId: string;
    matchedOn: DuplicateMatch["matchedOn"];
    /** record_source, e.g. "charity_commission" / "companies_house" — decides source_priority. */
    source: string;
    /** The fields this matcher actually compared — written to entity_match_candidates.match_fields. */
    matchFields: Record<string, string>;
  }): Promise<{ id: string } | { error: string }>;
  markRecordStatus(
    rawRecordId: string,
    status: "validated" | "matched" | "rejected" | "error",
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

    async loadExistingOrganisationsForMatching() {
      // registrationNumbers is left undefined: nothing in this codebase writes
      // organisation_identifiers yet (see match-organisations.ts's header), so there is
      // nothing to select. findDuplicateMatch falls back to name + postcode, which is
      // the data this pipeline actually populates.
      return fetchAllPages(async (from, to) =>
        supabase.from("organisations").select("id, legal_name, postcode").range(from, to),
      );
    },

    async loadDismissedMatches(rawRecordId) {
      const { data, error } = await supabase
        .from("entity_match_candidates")
        .select("candidate_organisation_id")
        .eq("raw_source_record_id", rawRecordId)
        .eq("match_status", "confirmed_new");

      if (error) throw error;
      return (data ?? []).map((row) => row.candidate_organisation_id as string);
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

    async flagPotentialDuplicate({ rawRecordId, matchedOrganisationId, matchedOn, source, matchFields }) {
      const { data, error } = await supabase
        .from("entity_match_candidates")
        .insert({
          raw_source_record_id: rawRecordId,
          candidate_organisation_id: matchedOrganisationId,
          match_method: MATCH_METHOD_BY_MATCHED_ON[matchedOn],
          match_score: MATCH_SCORE_BY_MATCHED_ON[matchedOn],
          match_fields: matchFields,
          source_priority: sourcePriority(source),
        })
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
  // are never given an ORGANISATIONS column for either, by design (Bashir,
  // Project Leader, 9 Aug 2026): priority is a pure function of city/postcode,
  // both already stored — a stored copy would just be a derived value going
  // stale, when a filter over those columns gets the same answer on demand.
  // healthcareAligned has no real signal yet either way (see buildCriteriaInput).
  await store.recordCriteriaOutcome(record.id, criteria, org.organisation_type);
  if (criteria.outcome === "needs_review") counts.needsReview++;
  else counts.doesNotMeet++;
  counts.rejected++;
  return false;
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

  // Loaded once per run, not once per record — cheap for a batch of a few hundred, and
  // good enough for F042's scope. A record newly inserted earlier in this same batch is
  // not visible to later matches in the batch; two near-simultaneous duplicates within
  // one run are a narrower case than the cross-source one this ticket targets, and not
  // covered by its AC.
  const existingOrganisations = await store.loadExistingOrganisationsForMatching();

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

    if (
      await flagIfDuplicate(store, counts, record, org, existingOrganisations, "charity_commission")
    ) {
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

/**
 * Bespoke rather than sharing a generic loop with the other two functions
 * below: this source needs classifyCompaniesHouseSourceConfidence run against
 * the *raw* payload alongside standardize (F047's Tier A/B bypass — see
 * client-criteria.ts's sourceConfidence branch), which a
 * one-standardize-function-in-one-standardize-function-out shared loop
 * couldn't express without every other source paying for a field it doesn't have.
 */
export async function promotePendingCompaniesHouseRecords(
  store: OrganisationWriteStore | null = createDefaultOrganisationWriteStore(),
  criteriaCheck: (input: Parameters<typeof checkClientCriteria>[0]) => ClientCriteriaResult = checkClientCriteria,
): Promise<PromoteCounts> {
  requireStore(store);

  const pending = await store.loadPendingRecords("companies_house");
  const counts = newCounts(pending.length);
  const existingOrganisations = await store.loadExistingOrganisationsForMatching();

  for (const record of pending) {
    let raw: RawCompaniesHouseRecord;
    let org: StandardOrganisation;
    try {
      raw = record.raw_payload as RawCompaniesHouseRecord;
      org = standardizeCompaniesHouseRecord(raw);
    } catch (error) {
      // raw_payload is untyped JSON from the database. A legacy or malformed
      // record that doesn't match the expected shape can throw inside the
      // mapper. Catch it here so one bad record doesn't crash the whole batch.
      await reportError(error instanceof Error ? error : new Error(String(error)), {
        operation: "standardize.companies_house.promote",
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

    const sourceConfidence = classifyCompaniesHouseSourceConfidence(raw);
    const criteria = criteriaCheck({ ...buildCriteriaInput(org), sourceConfidence });
    if (!(await passesClientCriteria(store, counts, record, org, criteria))) {
      continue;
    }

    if (
      await flagIfDuplicate(store, counts, record, org, existingOrganisations, "companies_house")
    ) {
      continue;
    }

    const result = await store.insertOrganisation(org);
    if ("error" in result) {
      await reportError(new Error(result.error), {
        operation: "standardize.companies_house.promote",
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

/**
 * Bespoke rather than sharing a loop with the two functions above: this
 * source needs isConfidentMatch checked against the *raw* payload before
 * anything else. A low-confidence reconcile candidate (match: false) is
 * rejected outright here, before F047 criteria even runs — organisation_type
 * is always "charity" for this source, which F047 already auto-accepts (see
 * CLIENT_CRITERIA.acceptedOrganisationTypes), so criteria alone would never
 * catch a wrong match; only the source's own confidence signal can.
 */
export async function promotePendingFindThatCharityRecords(
  store: OrganisationWriteStore | null = createDefaultOrganisationWriteStore(),
  criteriaCheck: (input: Parameters<typeof checkClientCriteria>[0]) => ClientCriteriaResult = checkClientCriteria,
): Promise<PromoteCounts> {
  requireStore(store);

  const pending = await store.loadPendingRecords("find_that_charity");
  const counts = newCounts(pending.length);
  const existingOrganisations = await store.loadExistingOrganisationsForMatching();

  for (const record of pending) {
    let raw: RawFindThatCharityRecord;
    let org: StandardOrganisation;
    try {
      raw = record.raw_payload as RawFindThatCharityRecord;
      org = standardizeFindThatCharityRecord(raw);
    } catch (error) {
      // raw_payload is untyped JSON from the database. A legacy or malformed
      // record that doesn't match the expected shape can throw inside the
      // mapper. Catch it here so one bad record doesn't crash the whole batch.
      await reportError(error instanceof Error ? error : new Error(String(error)), {
        operation: "standardize.find_that_charity.promote",
        rawRecordId: record.id,
      });
      await store.markRecordStatus(record.id, "error");
      counts.failed++;
      continue;
    }

    if (!isUsable(org) || !isConfidentMatch(raw)) {
      await markInvalidRecord(store, counts, record);
      continue;
    }

    const criteria = criteriaCheck(buildCriteriaInput(org));
    if (!(await passesClientCriteria(store, counts, record, org, criteria))) {
      continue;
    }

    if (
      await flagIfDuplicate(store, counts, record, org, existingOrganisations, "find_that_charity")
    ) {
      continue;
    }

    const result = await store.insertOrganisation(org);
    if ("error" in result) {
      await reportError(new Error(result.error), {
        operation: "standardize.find_that_charity.promote",
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
