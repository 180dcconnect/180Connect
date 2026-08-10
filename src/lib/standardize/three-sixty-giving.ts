// F035: promotes pending 360Giving raw_source_records into the GRANTS table,
// by matching each grant's recipientOrganization against an organisation we
// already know from another source. Never creates an organisation — that is
// the whole point of AC1/AC3 ("attached to matching existing charity record
// where one is found" / "handled the same as an unmatched record from other
// sources... does not silently create a duplicate client"): there is no
// insertOrganisation call anywhere in this module.
//
// MATCHING IS A STOPGAP, FLAGGED RATHER THAN HIDDEN: the "correct" match
// target is organisation_identifiers (built for exactly this — see its
// comment in 20260804180000_create_org_children.sql, "Deduplication keys on
// the primary one"), but nothing in this codebase writes to that table yet.
// F041/F260's promote functions (write-organisations.ts) only ever insert
// into ORGANISATIONS. F042's own matcher hit the identical gap and punted on
// it (src/lib/dedup/match-organisations.ts: "registrationNumbers is optional
// ... because nothing in this codebase writes organisation_identifiers yet
// ... it is here so matching is correct the day it is [fixed]") — writing
// this module against the same empty table would match nothing in staging
// today, so instead this queries raw_source_records directly for an
// already-promoted charity_commission/companies_house record carrying the
// same registration number:
//   - companies_house: source_record_id IS the normalised company number
//     (confirmed in companieshouse.ts's shape functions), so an exact
//     source_record_id match is enough.
//   - charity_commission: source_record_id is organisation_number, not the
//     charity number, so this reads raw_payload->>reg_charity_number instead
//     (same ->> json-path filter pattern companieshouse.ts's
//     defaultResolveIncorporationWatermark already uses).
// Once organisation_identifiers gets a real write path (closing the same gap
// F042 flagged), this should move to querying that table instead — matching
// logic would then live in one place rather than two.

import { buildAdminClient } from "../supabase/admin-client-factory.ts";
import { reportError } from "../error-logging.ts";
import { normalizeCompanyNumber } from "../ingestion/sources/companieshouse.ts";
import type { PendingRecord } from "./write-organisations.ts";

export type StandardGrant = {
  grant_id: string;
  funder_name: string;
  amount_awarded: number | null;
  currency: string;
  award_date: string | null;
  grant_programme: string | null;
  description: string | null;
};

type RecipientIdentifiers = {
  charityNumber: string | null;
  companyNumber: string | null;
};

/** Shape confirmed live 2026-08-10 against api.threesixtygiving.org/api/v1. */
export type RawThreeSixtyGivingGrant = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  currency?: unknown;
  awardDate?: unknown;
  amountAwarded?: unknown;
  grantProgramme?: Array<{ title?: unknown }> | null;
  fundingOrganization?: Array<{ name?: unknown }> | null;
  recipientOrganization?: Array<{ charityNumber?: unknown; companyNumber?: unknown }> | null;
  [key: string]: unknown;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Maps one 360Giving grant record into a GRANTS row plus the recipient's
 * registration numbers to match against. Throws if the record has no usable
 * `id` — grants.grant_id is NOT NULL and it is 360Giving's own identifier,
 * not something this layer can invent.
 */
export function standardizeThreeSixtyGivingRecord(
  raw: RawThreeSixtyGivingGrant,
): { grant: StandardGrant; recipient: RecipientIdentifiers } {
  const grantId = asTrimmedString(raw.id);
  if (!grantId) {
    throw new Error("360Giving record has no usable grant id.");
  }

  const recipientOrg = raw.recipientOrganization?.[0];
  const fundingOrg = raw.fundingOrganization?.[0];
  const awardDate = asTrimmedString(raw.awardDate);

  return {
    grant: {
      grant_id: grantId,
      funder_name: asTrimmedString(fundingOrg?.name) ?? "Unknown funder",
      amount_awarded: typeof raw.amountAwarded === "number" ? raw.amountAwarded : null,
      currency: asTrimmedString(raw.currency) ?? "GBP",
      // Confirmed live shape is an ISO datetime ("2022-02-21T00:00:00+00:00");
      // grants.award_date is a plain date column.
      award_date: awardDate ? awardDate.slice(0, 10) : null,
      grant_programme: asTrimmedString(raw.grantProgramme?.[0]?.title) ?? null,
      description: asTrimmedString(raw.description),
    },
    recipient: {
      charityNumber: asTrimmedString(recipientOrg?.charityNumber),
      companyNumber: asTrimmedString(recipientOrg?.companyNumber),
    },
  };
}

export type PromoteGrantCounts = {
  read: number;
  matched: number;
  /** No existing organisation found — recorded as rejected, never as a new organisation (AC3). */
  unmatched: number;
  invalidData: number;
  failed: number;
};

function newCounts(read: number): PromoteGrantCounts {
  return { read, matched: 0, unmatched: 0, invalidData: 0, failed: 0 };
}

/**
 * Everything promotePendingThreeSixtyGivingRecords needs from the database,
 * behind an interface — same reasoning as write-organisations.ts's
 * OrganisationWriteStore: decision logic is testable without a database.
 */
export interface GrantWriteStore {
  loadPendingRecords(): Promise<PendingRecord[]>;
  findOrganisationByCharityNumber(charityNumber: string): Promise<{ id: string } | null>;
  findOrganisationByCompanyNumber(companyNumber: string): Promise<{ id: string } | null>;
  upsertGrant(
    organisationId: string,
    grant: StandardGrant,
  ): Promise<{ ok: true } | { error: string }>;
  markRecordStatus(
    rawRecordId: string,
    status: "matched" | "rejected" | "error",
    matchedOrganisationId?: string,
  ): Promise<void>;
}

export function createDefaultGrantWriteStore(): GrantWriteStore | null {
  const supabase = buildAdminClient();
  if (!supabase) return null;

  return {
    async loadPendingRecords() {
      const { data, error } = await supabase
        .from("raw_source_records")
        .select("id, raw_payload")
        .eq("record_source", "360giving")
        .eq("processing_status", "pending");

      if (error) throw error;
      return (data ?? []) as PendingRecord[];
    },

    async findOrganisationByCharityNumber(charityNumber) {
      const { data, error } = await supabase
        .from("raw_source_records")
        .select("matched_organisation_id")
        .eq("record_source", "charity_commission")
        .eq("raw_payload->>reg_charity_number", charityNumber)
        .not("matched_organisation_id", "is", null)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      const id = (data as { matched_organisation_id: string | null } | null)?.matched_organisation_id;
      return id ? { id } : null;
    },

    async findOrganisationByCompanyNumber(companyNumber) {
      const { data, error } = await supabase
        .from("raw_source_records")
        .select("matched_organisation_id")
        .eq("record_source", "companies_house")
        .eq("source_record_id", normalizeCompanyNumber(companyNumber))
        .not("matched_organisation_id", "is", null)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      const id = (data as { matched_organisation_id: string | null } | null)?.matched_organisation_id;
      return id ? { id } : null;
    },

    async upsertGrant(organisationId, grant) {
      const { error } = await supabase
        .from("grants")
        .upsert(
          {
            organisation_id: organisationId,
            grant_id: grant.grant_id,
            funder_name: grant.funder_name,
            amount_awarded: grant.amount_awarded,
            currency: grant.currency,
            award_date: grant.award_date,
            grant_programme: grant.grant_programme,
            description: grant.description,
          },
          { onConflict: "organisation_id,grant_id" },
        );

      if (error) return { error: error.message };
      return { ok: true };
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
  };
}

function requireStore(store: GrantWriteStore | null): asserts store is GrantWriteStore {
  if (!store) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
}

export async function promotePendingThreeSixtyGivingRecords(
  store: GrantWriteStore | null = createDefaultGrantWriteStore(),
): Promise<PromoteGrantCounts> {
  requireStore(store);

  const pending = await store.loadPendingRecords();
  const counts = newCounts(pending.length);

  for (const record of pending) {
    let mapped: ReturnType<typeof standardizeThreeSixtyGivingRecord>;
    try {
      mapped = standardizeThreeSixtyGivingRecord(record.raw_payload as RawThreeSixtyGivingGrant);
    } catch {
      // raw_payload is untyped JSON from the database — one malformed record
      // (no grant id) is rejected rather than crashing the whole batch, same
      // reasoning as promotePendingCompaniesHouseRecords' try/catch.
      await store.markRecordStatus(record.id, "rejected");
      counts.invalidData++;
      continue;
    }

    const { grant, recipient } = mapped;

    let organisationId: string | null = null;
    if (recipient.charityNumber) {
      organisationId = (await store.findOrganisationByCharityNumber(recipient.charityNumber))?.id ?? null;
    }
    if (!organisationId && recipient.companyNumber) {
      organisationId = (await store.findOrganisationByCompanyNumber(recipient.companyNumber))?.id ?? null;
    }

    if (!organisationId) {
      await store.markRecordStatus(record.id, "rejected");
      counts.unmatched++;
      continue;
    }

    const result = await store.upsertGrant(organisationId, grant);
    if ("error" in result) {
      await reportError(new Error(result.error), {
        operation: "standardize.three_sixty_giving.promote",
        rawRecordId: record.id,
      });
      await store.markRecordStatus(record.id, "error");
      counts.failed++;
      continue;
    }

    await store.markRecordStatus(record.id, "matched", organisationId);
    counts.matched++;
  }

  return counts;
}
