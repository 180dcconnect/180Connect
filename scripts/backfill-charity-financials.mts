/**
 * One-off catch-up for public.financial_periods, from the live Charity
 * Commission register.
 *
 *     npm run backfill:charity-financials
 *
 * Not the same job as backfill:financial-periods, which reads figures out of
 * raw payloads we already stored. That one can only recover what discovery
 * happened to capture — and discovery searches *forward from a registration
 * watermark*, so it imports charities registered since the last run, which have
 * filed no accounts yet. On staging that meant 774 Charity Commission raw
 * records carrying the `latest_income` key and five carrying a value.
 *
 * This script goes back to the API for the charities we already hold, and takes
 * the five years the register publishes per charity rather than the latest one.
 * It is the same code the weekly cron runs
 * (src/lib/ingestion/sources/charity-commission-financial-refresh.ts), called in
 * a loop until the history-call budget stops being the limit — so running it is
 * exactly equivalent to letting the cron catch up over several weeks, only
 * sooner.
 *
 * Idempotent: every write goes through the
 * (organisation_id, period_start, period_end, financial_source) unique index and
 * updates figures on conflict, so a re-run costs API calls and changes nothing
 * else. Safe to interrupt — the next run recomputes what is missing from what is
 * stored.
 *
 * Reuses the seed config guard so pointing it at production refuses loudly.
 */

import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";
import {
  HISTORY_CALL_BUDGET,
  runCharityCommissionFinancialRefresh,
} from "../src/lib/ingestion/sources/charity-commission-financial-refresh.ts";

/** Stops a runaway loop if a pass ever reports progress it did not make. */
const MAX_PASSES = 40;

async function main(): Promise<void> {
  // Throws SeedRefusedError against production, SeedConfigError when
  // unconfigured — the same guard the seeder uses, since this writes just as
  // broadly. The connection string itself is unused: the refresh job talks
  // through the Supabase service role, not pg.
  const config = resolveSeedConfig(process.env);
  console.log(`[backfill:charity-financials] target: ${config.target}`);

  if (!process.env.CHARITY_COMMISSION_API_KEY) {
    throw new SeedConfigError(
      "CHARITY_COMMISSION_API_KEY is not set — nothing to fetch from.",
    );
  }

  let pass = 0;
  let organisations = 0;
  let periods = 0;
  let historyCalls = 0;

  for (;;) {
    pass += 1;
    // The catch-up also revisits charities whose stored periods predate the
    // breakdown columns — the weekly job deliberately does not, since a
    // totals-only filer would then cost a call a week forever.
    const result = await runCharityCommissionFinancialRefresh({
      includeMissingBreakdown: true,
    });
    organisations += result.organisationsWritten;
    periods += result.periodsWritten;
    historyCalls += result.historyFetched;

    console.log(
      `[backfill:charity-financials] pass ${pass}: ` +
        `${result.checked} charities checked, ` +
        `${result.historyFetched} history calls, ` +
        `${result.periodsWritten} periods written for ${result.organisationsWritten} organisations`,
    );

    if (!result.budgetExhausted) break;
    if (result.historyFetched === 0) {
      // Budget reported exhausted without a single call: something is wrong
      // upstream, and another pass would repeat it forever.
      console.warn("[backfill:charity-financials] no progress in this pass — stopping.");
      break;
    }
    if (pass >= MAX_PASSES) {
      console.warn(
        `[backfill:charity-financials] stopped after ${MAX_PASSES} passes ` +
          `(${MAX_PASSES * HISTORY_CALL_BUDGET} history calls). Re-run to continue.`,
      );
      break;
    }
  }

  console.log(
    `\n[backfill:charity-financials] done — ${periods} periods across ` +
      `${organisations} organisations, ${historyCalls} history calls in ${pass} pass(es).`,
  );
  console.log(
    "    Re-run npm run backfill:scores so the SCOUT size factor picks the new\n" +
      "    income figures up — until then it is still scoring them as no-data.",
  );
}

main().catch(async (error: unknown) => {
  if (error instanceof SeedRefusedError) {
    console.error(`\n[backfill:charity-financials] ${error.message}\n`);
    process.exit(1);
  }
  if (error instanceof SeedConfigError) {
    console.error(`\n[backfill:charity-financials] ${error.message}\n`);
    await reportError(error, { script: "backfill-charity-financials", env: DB_URL_VAR });
    process.exit(1);
  }
  console.error("\n[backfill:charity-financials] failed.");
  console.error(error);
  await reportError(error, { script: "backfill-charity-financials", env: DB_URL_VAR });
  process.exit(1);
});
