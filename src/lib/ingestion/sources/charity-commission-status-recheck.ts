// Shared Charity Commission status watch (F049) — the one function the weekly cron
// route (src/app/api/cron/charity-commission-status-recheck/route.ts) calls, kept
// in this shared-function shape so the logic is unit-testable and has exactly one
// place to change. Mirrors companies-house-status-recheck.ts /
// runCompaniesHouseStatusRecheck.
//
// Never writes organisations.outreach_status — see the migration header on
// 20260809100200_create_organisation_status_flags.sql for why. This function only
// ever calls record_organisation_status_flag, which itself never touches that
// column either.

import { buildAdminClient } from "../../supabase/admin-client-factory.ts";
import { reportError } from "../../error-logging.ts";
import { sendCharityCommissionStatusDigest } from "../../email/charity-commission-digest.ts";
import { runIngestion } from "../runner.ts";
import type { RunSummary, RunTrigger } from "../type.ts";
import { ALIVE_REG_STATUS, STATUS_RECHECK_BATCH_SIZE } from "./charity-commission-criteria-config.ts";
import { createCharityCommissionStatusRecheckAdapter } from "./charity-commission.ts";

type BatchRow = {
  id: string;
  reg_charity_number: string | null;
  matched_organisation_id: string | null;
  reg_status: string | null;
};

export type CharityCommissionStatusRecheckResult = {
  summary: RunSummary | null;
  checked: number;
  flagged: number;
};

export async function runCharityCommissionStatusRecheck(
  trigger: RunTrigger,
): Promise<CharityCommissionStatusRecheckResult> {
  const supabase = buildAdminClient();
  if (!supabase) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  // Least-recently-rechecked first (nulls — never checked — sort first), only
  // already-promoted records with a registration number to refetch by: an
  // unpromoted or rejected record has no organisation to flag anything against.
  const { data, error } = await supabase
    .from("raw_source_records")
    .select(
      "id, reg_charity_number:raw_payload->>reg_charity_number, matched_organisation_id, " +
        "reg_status:raw_payload->>reg_status",
    )
    .eq("record_source", "charity_commission")
    .eq("processing_status", "validated")
    .not("matched_organisation_id", "is", null)
    .order("status_last_checked_at", { ascending: true, nullsFirst: true })
    .limit(STATUS_RECHECK_BATCH_SIZE);

  if (error) throw error;
  // Cast through unknown: two aliased raw_payload->>x extractions in one select
  // string is more than supabase-js's generated select-string type parser can
  // statically resolve (a single one, as companies-house-status-recheck.ts uses,
  // parses fine) — the runtime shape is exactly BatchRow regardless.
  const batch = ((data ?? []) as unknown as BatchRow[]).filter(
    (row): row is BatchRow & { reg_charity_number: string } => Boolean(row.reg_charity_number),
  );

  if (batch.length === 0) {
    return { summary: null, checked: 0, flagged: 0 };
  }

  const registeredNumbers = batch.map((row) => row.reg_charity_number);
  const adapter = createCharityCommissionStatusRecheckAdapter(registeredNumbers);
  const [summary] = await runIngestion([adapter], trigger);

  const ids = batch.map((row) => row.id);

  const { error: touchError } = await supabase
    .from("raw_source_records")
    .update({ status_last_checked_at: new Date().toISOString() })
    .in("id", ids);
  if (touchError) {
    await reportError(touchError, {
      operation: "ingestion.charity_commission.status_recheck.touch_cursor",
    });
  }

  // Re-read after the recheck adapter's fetch — a changed payload was rewritten
  // by runIngestion's checksum-based upsert; an unchanged one is untouched, so
  // old and new status are trivially equal below and nothing gets flagged.
  const { data: refreshed, error: refreshedError } = await supabase
    .from("raw_source_records")
    .select(
      "id, reg_charity_number:raw_payload->>reg_charity_number, matched_organisation_id, " +
        "reg_status:raw_payload->>reg_status",
    )
    .in("id", ids);
  if (refreshedError) throw refreshedError;

  const refreshedRows = (refreshed ?? []) as unknown as BatchRow[];
  const refreshedById = new Map(refreshedRows.map((row) => [row.id, row]));

  let flagged = 0;
  for (const before of batch) {
    const after = refreshedById.get(before.id);
    if (!after?.matched_organisation_id || !after.reg_charity_number) continue;

    const oldStatus = before.reg_status ?? "unknown";
    const newStatus = after.reg_status ?? "unknown";

    if (oldStatus === newStatus) continue;
    // Recovered to registered — leave any existing open flag as-is for admin
    // review rather than auto-resolving it, same reasoning as the Companies House
    // job's ALIVE_COMPANY_STATUS branch.
    if (newStatus === ALIVE_REG_STATUS) continue;

    const { error: rpcError } = await supabase.rpc("record_organisation_status_flag", {
      p_organisation_id: after.matched_organisation_id,
      p_company_number: after.reg_charity_number,
      p_previous_status: oldStatus,
      p_new_status: newStatus,
      p_source: "charity_commission",
    });
    if (rpcError) {
      await reportError(rpcError, {
        operation: "ingestion.charity_commission.status_recheck.record_flag",
        organisationId: after.matched_organisation_id,
      });
      continue;
    }
    flagged++;
  }

  await sendCharityCommissionStatusDigest({ flagged });

  return { summary, checked: batch.length, flagged };
}
