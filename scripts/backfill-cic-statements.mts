// Fills ORGANISATIONS.cic_community_statement from Companies House CIC36 filings.
//
//   npm run backfill:cic-statements -- --dry-run   # report the queue, write nothing
//   npm run backfill:cic-statements               # drain the queue
//   npm run backfill:cic-statements -- --limit 20 # attempt only the next 20
//
// The primary vehicle for this job. The admin button on /admin/companies-house
// runs the same code but is capped at MAX_BACKFILL per press, because a server
// action has a function-timeout budget; one company costs two API calls, a
// ~1.2MB download and several seconds of OCR, so a few hundred of them fit in
// no serverless invocation. This has no ceiling and loops until nothing is
// pending.
//
// Idempotent and safe to interrupt. Every attempt sets
// cic_statement_checked_at, so a re-run picks up where this one stopped rather
// than re-reading filings it already read. A company that failed transiently is
// deliberately left unchecked and comes back round on the next run.
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// COMPANIES_HOUSE_API_KEY in .env.local, plus data/eng.traineddata
// (npm run tesseract:fetch).

import { buildAdminClient } from "../src/lib/supabase/admin-client-factory.ts";
import { createSupabaseIngestionStore } from "../src/lib/ingestion/store.ts";
import { ocrUnavailableReason } from "../src/lib/cic-statement/ocr.ts";
import {
  MAX_BACKFILL,
  findCicTargets,
  runCicBackfill,
} from "../src/lib/cic-statement/backfill.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";

/** Stops a runaway loop if a pass ever reports progress it did not make. */
const MAX_PASSES = 200;

function numericFlag(name: string): number | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = Number(process.argv[index + 1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  // The same guard the seeder uses. This writes across the whole client list,
  // so pointing it at production must refuse loudly rather than depend on
  // whoever ran it having checked their .env.local first.
  const config = resolveSeedConfig(process.env);
  console.log(`[backfill:cic-statements] target: ${config.target}`);

  if (!process.env.COMPANIES_HOUSE_API_KEY?.trim()) {
    throw new SeedConfigError("COMPANIES_HOUSE_API_KEY is not set — nothing to fetch from.");
  }

  const ocrProblem = ocrUnavailableReason();
  if (ocrProblem) throw new SeedConfigError(ocrProblem);

  const supabase = buildAdminClient();
  if (!supabase) {
    throw new SeedConfigError(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  const { coverage } = await findCicTargets(supabase);
  console.log(`Companies with a company number: ${coverage.companies}`);
  console.log(`  already asked about:           ${coverage.checked}`);
  console.log(`  of those, holding a statement: ${coverage.withStatement}`);
  console.log(`  still queued:                  ${coverage.pending}\n`);

  if (dryRun) {
    console.log("Dry run — nothing was written. Re-run without --dry-run to apply.");
    return;
  }
  if (coverage.pending === 0) {
    console.log("Nothing queued — every company has been asked about.");
    return;
  }

  // The data-handling policy is loaded once and fails closed: if the rules
  // cannot be read, nothing is fetched. Same rule as the ingestion runner —
  // no external text is stored unfiltered, and a missing policy is a reason to
  // stop rather than a reason to proceed carefully.
  const policy = await createSupabaseIngestionStore(supabase).loadDataHandlingPolicy();
  console.log(`Data handling rules version ${policy.version} loaded.\n`);

  const perPass = numericFlag("--limit") ?? MAX_BACKFILL;
  let attempted = 0;
  let written = 0;
  let notCic = 0;
  let failed = 0;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const outcome = await runCicBackfill(supabase, perPass, policy, (done, total, company) => {
      // One line per company, overwritten in place: several hundred companies
      // at a few seconds each is a long silence otherwise, and a scrolling log
      // of every company number buries the summary.
      process.stdout.write(`\r  pass ${pass}: ${done}/${total} — ${company}          `);
    });
    process.stdout.write("\r");

    attempted += outcome.attempted;
    written += outcome.written;
    notCic += outcome.notCic;
    failed += outcome.failed;

    console.log(
      `  pass ${pass}: attempted ${outcome.attempted}, stored ${outcome.written}, ` +
        `not a CIC ${outcome.notCic}, failed ${outcome.failed}, ${outcome.remaining} remaining`,
    );

    if (outcome.attempted === 0) break;
    // `remaining` counts failures back in, so a pass that only failed would
    // otherwise loop for ever retrying the same broken companies.
    if (outcome.remaining <= failed) break;

    if (numericFlag("--limit") !== null) break;
  }

  console.log(
    `\nDone. Attempted ${attempted}: stored ${written}, ${notCic} were not CICs, ${failed} failed.`,
  );
  if (failed > 0) {
    console.log("Failed companies are still queued — re-run to retry them.");
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof SeedRefusedError) {
    console.error(`Refused: ${error.message}`);
    process.exit(1);
  }
  if (error instanceof SeedConfigError) {
    console.error(`Not configured: ${error.message} (${DB_URL_VAR})`);
    process.exit(1);
  }
  throw error;
}
