// F048 — Data Discrepancy Detection: the comparison itself, plus the orchestration
// that runs it after a confirmed cross-source match.
//
// findFieldDiscrepancies is pure, no database — same reasoning as
// match-organisations.ts's findDuplicateMatch: decision logic stays testable
// without Supabase. detectAndFlagDiscrepancies is the DB-touching wrapper, behind
// an injectable store (same DI pattern as write-organisations.ts's
// OrganisationWriteStore) so it's testable with a fake.
//
// Where this runs: called from PATCH /api/admin/duplicates, right after
// decide_duplicate_flag confirms a match (p_confirmed = true). That RPC call and
// this one are two separate database round trips, not one transaction — if
// detection throws after the match is already confirmed, the confirmation is not
// rolled back (blocking an admin's already-made decision on a secondary check
// would be worse), but the failure must not be swallowed either. See the route's
// own comment for how that surfaces to the admin.
//
// MVP field scope: legal_name, website, contact_email, address_line_1, city,
// postcode — see the migration header
// (20260811090000_create_field_discrepancies.sql) for why these six and not the
// rest of StandardOrganisation.

import type { createClient } from "../supabase/server.ts";
import { reportError } from "../error-logging.ts";
import { standardizeCharityCommissionRecord } from "../standardize/charity-commission.ts";
import { standardizeCompaniesHouseRecord } from "../standardize/companies-house.ts";
import type { StandardOrganisation } from "../standardize/types.ts";

export const DISCREPANCY_FIELDS = [
  "legal_name",
  "website",
  "contact_email",
  "address_line_1",
  "city",
  "postcode",
] as const;

export type DiscrepancyField = (typeof DISCREPANCY_FIELDS)[number];

export type FieldDiscrepancy = {
  fieldName: DiscrepancyField;
  existingValue: string;
  incomingValue: string;
};

/**
 * Compares the fields both sides actually provide. A field is only flagged when
 * both the existing and incoming values are non-empty and differ — filling in a
 * field the existing record left blank is not a conflict, it's an improvement.
 */
export function findFieldDiscrepancies(
  incoming: Pick<StandardOrganisation, DiscrepancyField>,
  existing: Pick<StandardOrganisation, DiscrepancyField>,
  fields: readonly DiscrepancyField[] = DISCREPANCY_FIELDS,
): FieldDiscrepancy[] {
  const discrepancies: FieldDiscrepancy[] = [];
  for (const fieldName of fields) {
    const existingValue = existing[fieldName].trim();
    const incomingValue = incoming[fieldName].trim();
    if (existingValue === "" || incomingValue === "") continue;
    if (existingValue === incomingValue) continue;
    discrepancies.push({ fieldName, existingValue, incomingValue });
  }
  return discrepancies;
}

const STANDARDIZE_BY_SOURCE: Record<string, (raw: never) => StandardOrganisation> = {
  charity_commission: standardizeCharityCommissionRecord as (raw: never) => StandardOrganisation,
  companies_house: standardizeCompaniesHouseRecord as (raw: never) => StandardOrganisation,
};

export type EntityMatchCandidateForDetection = {
  rawSourceRecordId: string;
  candidateOrganisationId: string;
};

export type RawSourceRecordForDetection = {
  recordSource: string;
  rawPayload: unknown;
};

/**
 * Everything detectAndFlagDiscrepancies needs from the database, behind an
 * interface — same reasoning as OrganisationWriteStore.
 */
export interface DiscrepancyDetectionStore {
  loadEntityMatchCandidate(
    entityMatchCandidateId: string,
  ): Promise<EntityMatchCandidateForDetection | null>;
  loadRawSourceRecord(rawSourceRecordId: string): Promise<RawSourceRecordForDetection | null>;
  /** The organisation's current values, and which source originally created it. */
  loadOrganisationForComparison(
    organisationId: string,
  ): Promise<{ organisation: Pick<StandardOrganisation, DiscrepancyField>; source: string } | null>;
  recordDiscrepancy(input: {
    organisationId: string;
    fieldName: DiscrepancyField;
    existingValue: string;
    existingSource: string;
    incomingValue: string;
    incomingSource: string;
    rawSourceRecordId: string;
    entityMatchCandidateId: string;
  }): Promise<{ error: string } | { ok: true }>;
}

/**
 * Runs after decide_duplicate_flag confirms entityMatchCandidateId is a real
 * match: maps the incoming raw record with the right source's standardize
 * function, compares it against the existing organisation's current values, and
 * flags each differing field via the store. Never throws for a data problem
 * (malformed payload, unrecognised source) — those are reported and treated as
 * "nothing to flag", the same way write-organisations.ts's promote loop treats a
 * mapper failure as a per-record problem rather than crashing the whole batch.
 */
export async function detectAndFlagDiscrepancies(
  entityMatchCandidateId: string,
  store: DiscrepancyDetectionStore,
): Promise<{ flagged: number }> {
  const candidate = await store.loadEntityMatchCandidate(entityMatchCandidateId);
  if (!candidate) {
    await reportError(new Error("Entity match candidate not found for discrepancy detection"), {
      operation: "discrepancies.detect",
      entityMatchCandidateId,
    });
    return { flagged: 0 };
  }

  const rawRecord = await store.loadRawSourceRecord(candidate.rawSourceRecordId);
  if (!rawRecord) {
    await reportError(new Error("Raw source record not found for discrepancy detection"), {
      operation: "discrepancies.detect",
      entityMatchCandidateId,
      rawSourceRecordId: candidate.rawSourceRecordId,
    });
    return { flagged: 0 };
  }

  const standardize = STANDARDIZE_BY_SOURCE[rawRecord.recordSource];
  if (!standardize) {
    // Sources like find_that_charity are reserved in the record_source enum but have
    // no standardize mapper yet (see write-organisations.ts) — nothing to compare.
    await reportError(new Error(`No standardize mapper for source: ${rawRecord.recordSource}`), {
      operation: "discrepancies.detect",
      entityMatchCandidateId,
      recordSource: rawRecord.recordSource,
    });
    return { flagged: 0 };
  }

  let incoming: StandardOrganisation;
  try {
    incoming = standardize(rawRecord.rawPayload as never);
  } catch (error) {
    await reportError(error instanceof Error ? error : new Error(String(error)), {
      operation: "discrepancies.detect.standardize",
      entityMatchCandidateId,
      rawSourceRecordId: candidate.rawSourceRecordId,
    });
    return { flagged: 0 };
  }

  const existing = await store.loadOrganisationForComparison(candidate.candidateOrganisationId);
  if (!existing) {
    await reportError(new Error("Organisation not found for discrepancy detection"), {
      operation: "discrepancies.detect",
      entityMatchCandidateId,
      organisationId: candidate.candidateOrganisationId,
    });
    return { flagged: 0 };
  }

  const discrepancies = findFieldDiscrepancies(incoming, existing.organisation);

  let flagged = 0;
  for (const discrepancy of discrepancies) {
    const result = await store.recordDiscrepancy({
      organisationId: candidate.candidateOrganisationId,
      fieldName: discrepancy.fieldName,
      existingValue: discrepancy.existingValue,
      existingSource: existing.source,
      incomingValue: discrepancy.incomingValue,
      incomingSource: rawRecord.recordSource,
      rawSourceRecordId: candidate.rawSourceRecordId,
      entityMatchCandidateId,
    });
    if ("error" in result) {
      await reportError(new Error(result.error), {
        operation: "discrepancies.detect.record",
        entityMatchCandidateId,
        fieldName: discrepancy.fieldName,
      });
      continue;
    }
    flagged++;
  }

  return { flagged };
}

/**
 * Real, Supabase-backed store. Takes an already-built request-scoped client
 * (from @/lib/supabase/server's createClient()), not the admin/service-role
 * client — unlike write-organisations.ts's pipeline writes, this runs as a
 * follow-up inside the signed-in admin's own PATCH request, so both RPCs it
 * calls run under that admin's session and self-check app.is_admin() themselves
 * (see the migration).
 */
export function createDiscrepancyDetectionStore(
  supabase: Awaited<ReturnType<typeof createClient>>,
): DiscrepancyDetectionStore {
  return {
    async loadEntityMatchCandidate(entityMatchCandidateId) {
      const { data, error } = await supabase
        .from("entity_match_candidates")
        .select("raw_source_record_id, candidate_organisation_id")
        .eq("id", entityMatchCandidateId)
        .maybeSingle();

      if (error) throw error;
      if (!data || !data.candidate_organisation_id) return null;
      return {
        rawSourceRecordId: data.raw_source_record_id,
        candidateOrganisationId: data.candidate_organisation_id,
      };
    },

    async loadRawSourceRecord(rawSourceRecordId) {
      const { data, error } = await supabase
        .from("raw_source_records")
        .select("record_source, raw_payload")
        .eq("id", rawSourceRecordId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return { recordSource: data.record_source, rawPayload: data.raw_payload };
    },

    async loadOrganisationForComparison(organisationId) {
      const { data: org, error: orgError } = await supabase
        .from("organisations")
        .select("legal_name, website, contact_email, address_line_1, city, postcode")
        .eq("id", organisationId)
        .maybeSingle();

      if (orgError) throw orgError;
      if (!org) return null;

      // The record that originally created this organisation — see the migration
      // header for why this approximates provenance rather than tracking it
      // per-field (that's F044's job).
      const { data: origin, error: originError } = await supabase
        .from("raw_source_records")
        .select("record_source")
        .eq("matched_organisation_id", organisationId)
        .eq("processing_status", "validated")
        .limit(1)
        .maybeSingle();

      if (originError) throw originError;

      // website/contact_email are nullable columns — StandardOrganisation's "empty
      // string, never null" guarantee (see standardize/*.ts) only holds for rows a
      // standardize function produced. A row read back from the table carries no
      // such guarantee, so it's enforced here rather than in findFieldDiscrepancies,
      // which assumes every field is already a string.
      const organisation: Pick<StandardOrganisation, DiscrepancyField> = {
        legal_name: org.legal_name ?? "",
        website: org.website ?? "",
        contact_email: org.contact_email ?? "",
        address_line_1: org.address_line_1 ?? "",
        city: org.city ?? "",
        postcode: org.postcode ?? "",
      };

      return { organisation, source: origin?.record_source ?? "unknown" };
    },

    async recordDiscrepancy(input) {
      const { error } = await supabase.rpc("record_field_discrepancy", {
        p_organisation_id: input.organisationId,
        p_field_name: input.fieldName,
        p_existing_value: input.existingValue,
        p_existing_source: input.existingSource,
        p_incoming_value: input.incomingValue,
        p_incoming_source: input.incomingSource,
        p_raw_source_record_id: input.rawSourceRecordId,
        p_entity_match_candidate_id: input.entityMatchCandidateId,
      });

      if (error) return { error: error.message };
      return { ok: true };
    },
  };
}
