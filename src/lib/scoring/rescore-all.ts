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
// Serverless reality check (review of PR #496): one sequential round-trip per
// organisation can outlive a serverless function timeout on a real book, which
// would kill the failure reporting mid-flight. Two mitigations, both inside the
// same best-effort contract rather than around it:
//   1. rows are persisted in small parallel chunks, cutting wall time ~8x;
//   2. the sweep keeps an eye on elapsed time and STOPS cleanly at a page
//      boundary when the budget runs out, returning incomplete: true so the
//      admin is told exactly what happened and how to finish the job — instead
//      of the platform killing us into silence.

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
  outreach_messages: { sent_at: string | null }[] | null;
};

/** F093: most recent sent-message timestamp; null sent_at rows (drafts,
 * scheduled, failed) are skipped naturally. Mirrors rescore.ts's helper. */
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

export type RescoreAllResult = {
  ok: boolean;
  scored: number;
  failed: number;
  /** True when the sweep stopped early on its own terms (budget), not on error. */
  incomplete?: boolean;
  error?: string;
};

const PAGE_SIZE = 200;

/** Rows persisted concurrently within a page. Bounded so we never open more
 * PostgREST connections than Supabase pooler is comfortable with. */
const CHUNK = 8;

/**
 * Wall-time budget for the whole sweep. Deliberately under typical serverless
 * limits (~60s on Vercel hobby/Pro defaults for server actions) so the stop is
 * OURS — clean, logged, reported — rather than the platform's.
 */
const BUDGET_MS = 40_000;

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
  let incomplete = false;
  const firstFailure: { id: string; message: string }[] = [];
  const startedAt = Date.now();

  // Paged scan so memory stays flat regardless of book size. The filter is on
  // the primary key and the order is stable, so pages cannot skip or repeat rows.
  for (let from = 0; ; from += PAGE_SIZE) {
    if (Date.now() - startedAt > BUDGET_MS) {
      // Stop at our own hand, not the platform's: whatever was written stays
      // written (per-row upserts commit independently), and what remains is
      // reported so the backfill job can finish it.
      incomplete = true;
      break;
    }

    const { data, error } = await admin
      .from("organisations")
      .select(
        "id, city, sector, outreach_status, total_income, financial_periods(total_income, period_end), grants(count), outreach_messages(sent_at)",
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

    for (let i = 0; i < data.length; i += CHUNK) {
      await Promise.all(
        data.slice(i, i + CHUNK).map(async (row) => {
          const scoreable: ScoreableOrganisation = {
            city: row.city,
            sector: row.sector,
            outreach_status: row.outreach_status,
            total_income: row.total_income,
            financial_periods: row.financial_periods ?? [],
            last_contacted_at: lastContactedFrom(row.outreach_messages),
            matched_grant_count: row.grants?.[0]?.count ?? null,
          };
          const result = await persistLatestScore(admin, row.id, scoreable, config.weights);
          if (result.ok) {
            scored += 1;
          } else {
            failed += 1;
            if (firstFailure.length < 5) firstFailure.push({ id: row.id, message: result.error });
          }
        }),
      );
    }

    if (data.length < PAGE_SIZE) break;
  }

  if (failed > 0 || incomplete) {
    const detail =
      failed > 0
        ? `examples: ${firstFailure.map((f) => `${f.id}: ${f.message}`).join("; ")}`
        : "time budget reached";
    await reportError(
      new Error(
        `Rescore-after-reweight finished incomplete (${failed} failure(s); ${detail}).`,
      ),
      { operation: "scout_weights.rescore_all", weightsVersion: config.version ?? "unknown" },
    );
  }

  if (failed > 0) {
    return {
      ok: false,
      scored,
      failed,
      incomplete,
      error:
        `Weights were saved, but ${failed} client score(s) could not be recalculated. ` +
        "They have been logged for a backfill run.",
    };
  }

  if (incomplete) {
    return {
      ok: true,
      scored,
      failed: 0,
      incomplete,
      error:
        `Recalculation paused after ${scored} clients to stay within request time limits. ` +
        `Remaining scores will catch up with the next backfill run (npm run backfill:scores).`,
    };
  }

  return { ok: true, scored, failed: 0 };
}
