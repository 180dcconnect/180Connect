// F041: promotes pending charity_commission raw_source_records into
// organisations, using standardizeCharityCommissionRecord to map fields.
//
// Modelled on runner.ts's dependency-injection pattern (an injectable Store
// interface, a real Supabase-backed default implementation, a fake for
// tests) so this is testable without touching a real database.
//
// Explicitly NOT done here, and flagged rather than silently skipped:
//   - Client-criteria filtering (F047) — not built yet.
//   - Conflict flagging (F048) — not built yet.
//
// F042 (cross-source deduplication) IS done here: before inserting, every
// candidate is checked against existing organisations via
// findDuplicateMatch (src/lib/dedup/match-organisations.ts). A match is
// flagged in potential_duplicates for admin review instead of being
// inserted as a second row.
//
// processing_status semantics used here (per raw_source_records' check
// constraint: pending/validated/matched/rejected/error):
//   - 'validated': successfully mapped and inserted into organisations.
//   - 'matched': mapped, but findDuplicateMatch found an existing
//     organisation this record is probably a duplicate of — flagged in
//     potential_duplicates rather than inserted. If an admin later dismisses
//     the flag (decide_duplicate_flag with p_confirmed = false), the row is
//     reset to 'pending' so the next run promotes it normally.
//   - 'rejected': mapped, but failed minimal validation (empty legal_name —
//     organisations.legal_name is NOT NULL, and an empty string technically
//     satisfies that constraint but is not a usable record).
//   - 'error': the insert itself failed (e.g. a database error).

import { buildAdminClient } from "../supabase/admin-client-factory.ts";
import { reportError } from "../error-logging.ts";
import {
  findDuplicateMatch,
  type DuplicateMatch,
  type ExistingOrganisationForMatch,
} from "../dedup/match-organisations.ts";
import {
  standardizeCharityCommissionRecord,
  type RawCharityCommissionRecord,
  type StandardOrganisation,
} from "./charity-commission.ts";

export type PendingRecord = {
  id: string; // raw_source_records.id
  raw_payload: RawCharityCommissionRecord;
};

export type PromoteCounts = {
  read: number;
  inserted: number;
  flagged: number;
  rejected: number;
  failed: number;
};

/**
 * Everything promotePendingCharityCommissionRecords needs from the database,
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
  }): Promise<{ id: string } | { error: string }>;
  markRecordStatus(
    rawRecordId: string,
    status: "validated" | "matched" | "rejected" | "error",
    matchedOrganisationId?: string,
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
      const { data, error } = await supabase
        .from("organisations")
        .select("id, legal_name, postcode");

      if (error) throw error;
      return (data ?? []) as ExistingOrganisationForMatch[];
    },

    async loadDismissedMatches(rawRecordId) {
      const { data, error } = await supabase
        .from("potential_duplicates")
        .select("matched_organisation_id")
        .eq("raw_source_record_id", rawRecordId)
        .eq("status", "not_duplicate");

      if (error) throw error;
      return (data ?? []).map((row) => row.matched_organisation_id as string);
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

    async flagPotentialDuplicate({ rawRecordId, matchedOrganisationId, matchedOn }) {
      const { data, error } = await supabase
        .from("potential_duplicates")
        .insert({
          raw_source_record_id: rawRecordId,
          matched_organisation_id: matchedOrganisationId,
          matched_on: matchedOn,
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
  };
}

/** A record is usable if it at least has a non-empty legal_name. */
function isUsable(org: StandardOrganisation): boolean {
  return org.legal_name.trim() !== "";
}

export async function promotePendingCharityCommissionRecords(
  store: OrganisationWriteStore | null = createDefaultOrganisationWriteStore(),
): Promise<PromoteCounts> {
  if (!store) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const pending = await store.loadPendingRecords("charity_commission");
  const counts: PromoteCounts = {
    read: pending.length,
    inserted: 0,
    flagged: 0,
    rejected: 0,
    failed: 0,
  };

  // Loaded once per run, not once per record — cheap for a batch of a few hundred, and
  // good enough for F042's scope. A record newly inserted earlier in this same batch is
  // not visible to later matches in the batch; two near-simultaneous duplicates within
  // one run are a narrower case than the cross-source one this ticket targets, and not
  // covered by its AC.
  const existingOrganisations = await store.loadExistingOrganisationsForMatching();

  for (const record of pending) {
    const org = standardizeCharityCommissionRecord(record.raw_payload);

    if (!isUsable(org)) {
      await store.markRecordStatus(record.id, "rejected");
      counts.rejected++;
      continue;
    }

    const dismissedOrganisationIds = await store.loadDismissedMatches(record.id);
    const match = findDuplicateMatch(
      { legal_name: org.legal_name, postcode: org.postcode },
      existingOrganisations,
      new Set(dismissedOrganisationIds),
    );

    if (match) {
      const flagResult = await store.flagPotentialDuplicate({
        rawRecordId: record.id,
        matchedOrganisationId: match.organisationId,
        matchedOn: match.matchedOn,
      });
      if ("error" in flagResult) {
        await reportError(new Error(flagResult.error), {
          operation: "standardize.charity_commission.flag_duplicate",
          rawRecordId: record.id,
        });
        await store.markRecordStatus(record.id, "error");
        counts.failed++;
        continue;
      }

      await store.markRecordStatus(record.id, "matched", match.organisationId);
      counts.flagged++;
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
