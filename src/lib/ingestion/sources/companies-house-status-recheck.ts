// Shared Companies House status watch — the one function both the weekly cron
// route (src/app/api/cron/companies-house-status-recheck/route.ts) calls today,
// kept in this shared-function shape (rather than inlined in the route) for the
// same reason companies-house-discovery.ts is: so the logic is unit-testable and
// has exactly one place to change.
//
// Never writes organisations.outreach_status — see the migration header on
// 20260809100200_create_organisation_status_flags.sql for why. This function only
// ever calls record_organisation_status_flag, which itself never touches that
// column either.

import { buildAdminClient } from "../../supabase/admin-client-factory.ts";
import { reportError } from "../../error-logging.ts";
import { sendCompaniesHouseStatusDigest } from "../../email/companies-house-digest.ts";
import { runIngestion } from "../runner.ts";
import type { RunSummary, RunTrigger } from "../type.ts";
import { ALIVE_COMPANY_STATUS, STATUS_RECHECK_BATCH_SIZE } from "./companies-house-criteria-config.ts";
import { createCompaniesHouseStatusRecheckAdapter } from "./companieshouse.ts";

type BatchRow = {
  id: string;
  source_record_id: string;
  matched_organisation_id: string | null;
  company_status: string | null;
};

export type CompaniesHouseStatusRecheckResult = {
  summary: RunSummary | null;
  checked: number;
  flagged: number;
};

export async function runCompaniesHouseStatusRecheck(
  trigger: RunTrigger,
): Promise<CompaniesHouseStatusRecheckResult> {
  const supabase = buildAdminClient();
  if (!supabase) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  // Least-recently-rechecked first (nulls — never checked — sort first), only
  // already-promoted records: an unpromoted or rejected record has no
  // organisation to flag anything against.
  const { data, error } = await supabase
    .from("raw_source_records")
    .select("id, source_record_id, matched_organisation_id, company_status:raw_payload->>company_status")
    .eq("record_source", "companies_house")
    .eq("processing_status", "validated")
    .not("matched_organisation_id", "is", null)
    .order("status_last_checked_at", { ascending: true, nullsFirst: true })
    .limit(STATUS_RECHECK_BATCH_SIZE);

  if (error) throw error;
  const batch = (data ?? []) as BatchRow[];

  if (batch.length === 0) {
    return { summary: null, checked: 0, flagged: 0 };
  }

  const companyNumbers = batch.map((row) => row.source_record_id);
  const adapter = createCompaniesHouseStatusRecheckAdapter(companyNumbers);
  const [summary] = await runIngestion([adapter], trigger);

  const ids = batch.map((row) => row.id);

  const { error: touchError } = await supabase
    .from("raw_source_records")
    .update({ status_last_checked_at: new Date().toISOString() })
    .in("id", ids);
  if (touchError) {
    await reportError(touchError, {
      operation: "ingestion.companies_house.status_recheck.touch_cursor",
    });
  }

  // Re-read after the recheck adapter's fetch — a changed payload was rewritten
  // by runIngestion's checksum-based upsert; an unchanged one is untouched, so
  // old and new status are trivially equal below and nothing gets flagged.
  const { data: refreshed, error: refreshedError } = await supabase
    .from("raw_source_records")
    .select("id, source_record_id, matched_organisation_id, company_status:raw_payload->>company_status")
    .in("id", ids);
  if (refreshedError) throw refreshedError;

  const refreshedById = new Map((refreshed ?? []).map((row) => [(row as BatchRow).id, row as BatchRow]));

  let flagged = 0;
  for (const before of batch) {
    const after = refreshedById.get(before.id);
    if (!after?.matched_organisation_id) continue;

    const oldStatus = before.company_status ?? "unknown";
    const newStatus = after.company_status ?? "unknown";

    if (oldStatus === newStatus) continue;
    // Recovered to active — leave any existing open flag as-is for admin review
    // rather than auto-resolving it; a dip that already reversed itself is still
    // exactly the kind of drift the admin asked to see, not something to hide
    // because it self-corrected before they looked. No new flag needed either,
    // since "now active" is not itself something to review.
    if (newStatus === ALIVE_COMPANY_STATUS) continue;

    // Covers both an active -> non-active transition and a further drift between
    // two non-active statuses (e.g. administration -> liquidation) — the RPC
    // upserts the existing open flag's new_status in the latter case rather than
    // creating a second one.
    const { error: rpcError } = await supabase.rpc("record_organisation_status_flag", {
      p_organisation_id: after.matched_organisation_id,
      p_company_number: after.source_record_id,
      p_previous_status: oldStatus,
      p_new_status: newStatus,
      p_source: "companies_house",
    });
    if (rpcError) {
      await reportError(rpcError, {
        operation: "ingestion.companies_house.status_recheck.record_flag",
        organisationId: after.matched_organisation_id,
      });
      continue;
    }
    flagged++;
  }

  // F049 AC3: the flagged count must be part of the run's persistent history
  // (ingestion_runs), not only the digest email below — an admin looking at a past
  // run should be able to see how many records it flagged the same way they can
  // already see how many it failed.
  if (summary.runId) {
    const { error: flagCountError } = await supabase
      .from("ingestion_runs")
      .update({ records_flagged: flagged })
      .eq("id", summary.runId);
    if (flagCountError) {
      await reportError(flagCountError, {
        operation: "ingestion.companies_house.status_recheck.record_flagged_count",
      });
    }
  }

  await sendCompaniesHouseStatusDigest({ flagged });

  return { summary, checked: batch.length, flagged };
}
