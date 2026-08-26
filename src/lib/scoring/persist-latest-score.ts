// F058/F059: the single write path into LATEST_SCORES.
//
// Every rescore call site — the ingestion promote store, the manual-entry
// approval action, and scripts/backfill-priority-scores.mts — funnels through
// here so there is exactly one upsert shape to keep in sync with the table's
// constraints (score/band must travel together; scored_at moves on every
// write). Callers pass whatever client they already hold; writes require the
// service role (the migration grants authenticated SELECT only), so interactive
// callers should hand in createAdminClient()'s client — see rescoreOrganisation
// below for the ready-made wrapper.

import { DEFAULT_WEIGHTS, type ScoutWeights } from "./calculate-priority-score.ts";
import { computePriorityScore } from "./score-client.ts";
import type { ScoreableOrganisation } from "./score-client.ts";

/** Structural slice of a PostgREST client — just the upsert this module needs. */
type UpsertDb = {
  from(table: string): {
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string },
    ): {
      select(columns: string): PromiseLike<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
};

export type PersistedScoreResult =
  | { ok: true; score: number; band: string }
  | { ok: false; error: string };

export async function persistLatestScore(
  db: UpsertDb,
  organisationId: string,
  org: ScoreableOrganisation,
  // F096: callers load the active SCOUT config once per sweep and pass it down
  // so every row in a rescore is scored under the same generation. Defaults to
  // the MVP equal weights for callers that predate configurable scoring.
  weights: ScoutWeights = DEFAULT_WEIGHTS,
): Promise<PersistedScoreResult> {
  const { score, band } = computePriorityScore(org, [], weights);
  const { error } = await db
    .from("latest_scores")
    .upsert(
      {
        organisation_id: organisationId,
        priority_score: score,
        priority_band: band,
        score_source: "rule_engine",
        scored_at: new Date().toISOString(),
      },
      { onConflict: "organisation_id" },
    )
    .select("id");

  if (error) return { ok: false, error: error.message };
  return { ok: true, score, band };
}
