// F058/F059: convenience wrapper for interactive callers.
//
// persist-latest-score.ts is deliberately client-agnostic and testable without
// a database; this file adds the two things server-side call sites need — a
// service-role client, because LATEST_SCORES grants authenticated SELECT only
// (migration 20260831200000), and a way to load the scoring inputs straight
// from the database so every hook site can pass just an organisation id.
//
// Review note (PR #482): the status routes and the manual-entry action only
// hold an id, and duplicating "fetch the org's city/income" at each of them
// invites exactly the drift that left scores stale — so the read happens here,
// once, through the same resolution order score-client.ts documents.
//
// Best-effort by contract: a failed rescore must never fail the user's save.
// The list treats a missing LATEST_SCORES row as "unscored" (F058 AC3), so a
// skipped rescore degrades to a visibly unscored client, not a broken filter —
// and the error still lands in the error log for the backfill to sweep up.

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/error-logging";
import { getActiveScoutConfig } from "./configured-weights.ts";
import { persistLatestScore, type PersistedScoreResult } from "./persist-latest-score.ts";
import type { ScoreableOrganisation } from "./score-client.ts";

type OrgRow = {
  city: string | null;
  sector: string | null;
  outreach_status: string;
  total_income: number | null;
  financial_periods: { total_income: number | null; period_end: string | null }[] | null;
  grants: { count: number }[] | null;
  outreach_messages: { sent_at: string | null }[] | null;
};

/**
 * F093: the recency half of the previous-contact signal — the org's most
 * recent *sent* message timestamp. Draft/scheduled/failed rows carry a null
 * sent_at and are ignored naturally by the max; an org with no messages at
 * all yields null, meaning status-only scoring.
 */
function lastContactedFrom(
  messages: { sent_at: string | null }[] | null,
): string | null {
  let latest: string | null = null;
  for (const message of messages ?? []) {
    if (message.sent_at && (latest === null || message.sent_at > latest)) {
      latest = message.sent_at;
    }
  }
  return latest;
}

/**
 * Rescores one organisation using its current database state — the entry point
 * for hooks that hold only an id (status change, bulk status change, manual
 * entry approval). Reads the same fields the backfill reads, so a hook and the
 * backfill can never disagree about what a client's score should be.
 */
export async function rescoreOrganisation(
  organisationId: string,
): Promise<PersistedScoreResult> {
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Service-role client unavailable; score not persisted." };
  }

  const { data: org, error } = await admin
    .from("organisations")
    .select(
      "city, sector, outreach_status, total_income, financial_periods(total_income, period_end), grants(count), outreach_messages(sent_at)",
    )
    .eq("id", organisationId)
    .maybeSingle<OrgRow>();

  if (error) return { ok: false, error: error.message };
  if (!org) return { ok: false, error: "Organisation not found; score not persisted." };

  const scoreable: ScoreableOrganisation = {
    city: org.city,
    sector: org.sector,
    outreach_status: org.outreach_status,
    total_income: org.total_income,
    financial_periods: org.financial_periods ?? [],
    last_contacted_at: lastContactedFrom(org.outreach_messages),
    matched_grant_count: org.grants?.[0]?.count ?? null,
  };

  // F096: score under the weights of the currently active SCOUT generation, so
  // a weight change is reflected by the very next rescore without code changes.
  const config = await getActiveScoutConfig();
  return persistLatestScore(admin, organisationId, scoreable, config.weights);
}

/** Reports a best-effort rescore failure to the error log, uniformly. */
export async function reportRescoreFailure(
  result: PersistedScoreResult,
  operation: string,
  organisationId: string,
): Promise<void> {
  if (result.ok) return;
  await reportError(new Error(result.error), { operation, organisationId });
}
