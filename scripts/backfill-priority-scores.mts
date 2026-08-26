/**
 * Backfills public.latest_scores for every organisation (F058/F059).
 *
 *     npm run backfill:scores
 *
 * The rescore hooks (ingestion promote, manual-entry approval) only cover rows
 * created after they landed. This script sweeps everything that predates them,
 * and is also the recovery path when a hook's best-effort write fails — the
 * list treats a missing LATEST_SCORES row as "unscored" (F058 AC3), so gaps are
 * visible, not silent, and this closes them.
 *
 * Idempotent: an upsert on organisation_id, so running it twice leaves the same
 * rows as running it once (with fresher scored_at values). Scores come from the
 * same pure rule engine the hooks use (src/lib/scoring/score-client.ts) — there
 * is no second scoring implementation here.
 *
 * Uses pg directly for the same reasons seed.mts does: one transaction, RLS not
 * in the way (the table grants authenticated SELECT only), and no PostgREST
 * row-count ceiling. Reuses the seed config guard so pointing it at production
 * refuses loudly rather than rewriting every live client's score.
 */

import { Client } from "pg";
import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";
import { sanitizeWeights } from "../src/lib/scoring/calculate-priority-score.ts";
import {
  PRIORITY_BAND_THRESHOLDS,
  computePriorityScore,
} from "../src/lib/scoring/score-client.ts";

type OrgRow = {
  id: string;
  city: string | null;
  sector: string | null;
  outreach_status: string;
  total_income: number | null;
  matched_grant_count: number | null;
};

/**
 * F096: scores must be replayed under the weights of the currently active SCOUT
 * generation, not a hard-coded set — otherwise a sweep after an admin reweight
 * would silently undo their change. Read once up front (pg, same reason as the
 * writes); falls back to the engine defaults if the row is missing/unreadable.
 */
async function loadActiveWeights(client: Client) {
  const { rows } = await client.query<{ weights: unknown }>(
    `
    select config -> 'weights' as weights
    from public.model_versions
    where model_name = 'SCOUT' and is_active
    limit 1
    `,
  );
  return sanitizeWeights(rows[0]?.weights);
}

async function main(): Promise<void> {
  // Throws SeedRefusedError against production, SeedConfigError when unconfigured
  // — deliberately the same guard the seeder uses, since this writes just as broad.
  const config = resolveSeedConfig(process.env);

  console.log(`[backfill:scores] target: ${config.target}`);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    await client.query("begin");

    const weights = await loadActiveWeights(client);

    const { rows } = await client.query<OrgRow>(
      `
      select
        o.id,
        o.city,
        o.sector,
        o.outreach_status,
        (
          select fp.total_income
          from public.financial_periods fp
          where fp.organisation_id = o.id
          order by fp.period_end desc nulls last
          limit 1
        ) as total_income,
        (
          select count(*)::int
          from public.grants g
          where g.organisation_id = o.id
        ) as matched_grant_count
      from public.organisations o
      `,
    );

    if (rows.length === 0) {
      await client.query("commit");
      console.log("[backfill:scores] no organisations found — nothing to do.");
      return;
    }

    // One multi-row upsert per batch keeps the round-trips flat on large lists
    // without building a single statement of unbounded size.
    const BATCH_SIZE = 200;
    let scoredCount = 0;
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((row) => {
        const { score, band } = computePriorityScore(row, [], weights);
        scoredCount += 1;
        [
          row.id,
          score,
          band,
        ].forEach((value) => values.push(value));
        return `($${values.length - 2}, $${values.length - 1}, $${values.length}, 'rule_engine', now())`;
      });

      await client.query(
        `
        insert into public.latest_scores
          (organisation_id, priority_score, priority_band, score_source, scored_at)
        values ${placeholders.join(",\n       ")}
        on conflict (organisation_id) do update set
          priority_score = excluded.priority_score,
          priority_band = excluded.priority_band,
          score_source = excluded.score_source,
          scored_at = now(),
          updated_at = now()
        `,
        values,
      );
    }

    await client.query("commit");

    const byBand = { high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const row of rows) byBand[computePriorityScore(row, [], weights).band] += 1;

    console.log(`[backfill:scores] scored ${scoredCount} organisations`);
    console.log(
      `    high (>= ${PRIORITY_BAND_THRESHOLDS.high})   ${byBand.high}\n` +
        `    medium (>= ${PRIORITY_BAND_THRESHOLDS.medium})  ${byBand.medium}\n` +
        `    low              ${byBand.low}`,
    );
    console.log(
      "\n[backfill:scores] sector factor stands at its documented neutral until F089" +
        "\nlands — see src/lib/scoring/score-client.ts's header.",
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(async (error: unknown) => {
  if (error instanceof SeedRefusedError) {
    console.error(`\n[backfill:scores] ${error.message}\n`);
    process.exit(1);
  }
  if (error instanceof SeedConfigError) {
    console.error(`\n[backfill:scores] ${error.message}\n`);
    await reportError(error, { script: "backfill-priority-scores", env: DB_URL_VAR });
    process.exit(1);
  }
  console.error("\n[backfill:scores] failed — no rows were written.");
  console.error(error);
  await reportError(error, { script: "backfill-priority-scores", env: DB_URL_VAR });
  process.exit(1);
});
