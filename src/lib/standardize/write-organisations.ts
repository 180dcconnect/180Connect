// F041: promotes pending charity_commission raw_source_records into
// organisations, using standardizeCharityCommissionRecord to map fields.
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
//   - Client-criteria filtering (F047) — same reasoning, not built yet.
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
  insertOrganisation(
    org: StandardOrganisation,
  ): Promise<{ id: string } | { error: string }>;
  markRecordStatus(
    rawRecordId: string,
    status: "validated" | "rejected" | "error",
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
    rejected: 0,
    failed: 0,
  };

  for (const record of pending) {
    const org = standardizeCharityCommissionRecord(record.raw_payload);

    if (!isUsable(org)) {
      await store.markRecordStatus(record.id, "rejected");
      counts.rejected++;
      continue;
    }

    const result = await store.insertOrganisation(org);
    if ("error" in result) {
      console.error(
        `[standardize.charity_commission] insert failed for raw record ${record.id}:`,
        result.error,
      );
      await store.markRecordStatus(record.id, "error");
      counts.failed++;
      continue;
    }

    await store.markRecordStatus(record.id, "validated", result.id);
    counts.inserted++;
  }

  return counts;
}