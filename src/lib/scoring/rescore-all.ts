// F096: rescoring every client after a weight change.
//
// AC2 of the ticket: changing a weight must recalculate scores across affected
// *existing* clients, not only apply to newly imported ones. The per-row hooks
// (rescoreOrganisation) already keep individual rows fresh; this module is the
// sweep that replays the whole book under the new weights.
//
// Same best-effort contract as every other rescore call site, with one twist:
// here a partial failure must be *reported*, not swallowed — an admin just
// changed how the whole queue is prioritised, so "some rows could not be
// rescored" is exactly what they need to see. Failures land in the error log
// (ERROR_LOG DoD line) and in the returned summary for the UI banner; none of
// it throws.
//
// Batching mirrors scripts/backfill-priority-scores.mts's shape (paged reads,
// bounded batches) but goes through PostgREST + the service role instead of pg:
// this runs inside a Server Action, where only the Supabase clients exist.

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/error-logging";
import { getActiveScoutConfig } from "./configured-weights.ts";
import { persistLatestScore } from "./persist-latest-score.ts";
import type { ScoreableOrganisation } from "./score-client.ts";

type SweepRow = {
  id: string;
  city: string | null;
  sector: string | null;
  outreach_status: string;
  total_income: number | null;
  financial_periods: { total_income: number | null; period_end: string | null }[] | null;
  grants: { count: number }[] | null;
};

export type RescoreAllResult = {
  ok: boolean;
  scored: number;
  failed: number;
  error?: string;
};

const PAGE_SIZE = 200;

export async function rescoreAllOrganisations(): Promise<RescoreAllResult> {
  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      scored: 0,
      failed: 0,
      error: "Service-role client unavailable; no scores were recalculated.",
    };
  }

  const config = await getActiveScoutConfig();

  let scored = 0;
  let failed = 0;
  const firstFailure: { id: string; message: string }[] = [];

  // Paged scan so memory stays flat regardless of book size. The filter is on
  // the primary key and the order is stable, so pages cannot skip or repeat rows.
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("organisations")
      .select(
        "id, city, sector, outreach_status, total_income, financial_periods(total_income, period_end), grants(count)",
      )
      .order("id")
      .range(from, from + PAGE_SIZE - 1)
      .returns<SweepRow[]>();

    if (error) {
      return {
        ok: false,
        scored,
        failed,
        error: `Could not read organisations during the rescore sweep: ${error.message}`,
      };
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const scoreable: ScoreableOrganisation = {
        city: row.city,
        sector: row.sector,
        outreach_status: row.outreach_status,
        total_income: row.total_income,
        financial_periods: row.financial_periods ?? [],
        matched_grant_count: row.grants?.[0]?.count ?? null,
      };
      const result = await persistLatestScore(admin, row.id, scoreable, config.weights);
      if (result.ok) {
        scored += 1;
      } else {
        failed += 1;
        if (firstFailure.length < 5) firstFailure.push({ id: row.id, message: result.error });
      }
    }

    if (data.length < PAGE_SIZE) break;
  }

  if (failed > 0) {
    await reportError(
      new Error(
        `Rescore-after-reweight finished with ${failed} failure(s); ` +
          `examples: ${firstFailure.map((f) => `${f.id}: ${f.message}`).join("; ")}`,
      ),
      { operation: "scout_weights.rescore_all", weightsVersion: config.version ?? "unknown" },
    );
    return {
      ok: false,
      scored,
      failed,
      error: `Weights were saved, but ${failed} client score(s) could not be recalculated. They have been logged for a backfill run.`,
    };
  }

  return { ok: true, scored, failed: 0 };
}
