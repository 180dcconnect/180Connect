/**
 * Imports established charities from the Charity Commission's daily bulk
 * register extract.
 *
 *     npm run ingest:charity-commission-bulk -- --dry-run
 *     npm run ingest:charity-commission-bulk
 *     npm run ingest:charity-commission-bulk -- --limit 500
 *     npm run ingest:charity-commission-bulk -- --dir /path/to/unzipped
 *
 * A script rather than a cron route, deliberately: the extracts are 508MB of
 * charities and 1.26GB of annual returns uncompressed, which is not work for a
 * 300s serverless function. The filter's answer changes monthly at most, so an
 * operator running this when the criteria change is the right cadence. The
 * adapter itself is an ordinary DataSourceAdapter, so a cron route can be added
 * later without touching it.
 *
 * --dry-run streams and filters exactly as a real run does, then prints the
 * counts and writes nothing. Run it first, every time: today's filter selects
 * 4,704 charities, and a materially different number means the filter changed
 * under you. Importing tens of thousands of organisations nobody will contact
 * is the failure mode this flag exists to catch.
 *
 * --dir reads already-unzipped extracts from disk instead of downloading ~100MB
 * again. The files are the ones named in charity-commission-bulk-config.ts.
 *
 * Guarded by the seed config so pointing it at production refuses loudly.
 */

import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";
import { createCharityCommissionBulkAdapter } from "../src/lib/ingestion/sources/charity-commission-bulk.ts";
import { runIngestion } from "../src/lib/ingestion/runner.ts";

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const limitFlag = flag("limit");
  const limit = limitFlag ? Number(limitFlag) : undefined;
  const localDir = flag("dir") || undefined;

  if (limit !== undefined && !Number.isFinite(limit)) {
    throw new SeedConfigError("--limit needs a number.");
  }

  // Throws SeedRefusedError against production. Checked even for a dry run: the
  // point of the guard is that the operator knows which database they are
  // pointed at before they see numbers they might act on.
  const config = resolveSeedConfig(process.env);
  console.log(`[ingest:charity-commission-bulk] target: ${config.target}`);
  if (localDir) console.log(`[ingest:charity-commission-bulk] reading extracts from ${localDir}`);

  const adapter = createCharityCommissionBulkAdapter({
    localDir,
    limit,
    onStats: (stats) => {
      console.log(
        `\n[ingest:charity-commission-bulk] filter\n` +
          `    scanned            ${stats.charitiesScanned.toLocaleString()}\n` +
          `    registered         ${stats.registered.toLocaleString()}\n` +
          `    accepted           ${stats.accepted.toLocaleString()}\n` +
          `    annual return rows ${stats.annualReturnRows.toLocaleString()}\n`,
      );
    },
  });

  if (dryRun) {
    const result = await adapter.fetch();
    console.log(
      `[ingest:charity-commission-bulk] dry run — ${result.records.length.toLocaleString()} ` +
        `records would be written, nothing was.`,
    );
    const sample = result.records[0];
    if (sample) {
      const payload = sample.raw_payload as { charity: { charity_name: string | null } };
      console.log(`    first match: ${payload.charity.charity_name} (${sample.source_record_id})`);
    }
    return;
  }

  const [summary] = await runIngestion([adapter], { triggeredBy: "manual" });
  console.log(
    `\n[ingest:charity-commission-bulk] ${summary.status} — ` +
      `fetched ${summary.counts.fetched}, ` +
      `written ${summary.written.new} new / ${summary.written.changed} changed, ` +
      `skipped ${summary.counts.skipped}, failed ${summary.counts.failed}`,
  );
  if (summary.error) console.error(`    error: ${summary.error}`);
  console.log(
    "    Next: npm run standardize:run-charity-commission-bulk to promote these\n" +
      "    into ORGANISATIONS, then npm run backfill:scores.",
  );
}

main().catch(async (error: unknown) => {
  if (error instanceof SeedRefusedError) {
    console.error(`\n[ingest:charity-commission-bulk] ${error.message}\n`);
    process.exit(1);
  }
  if (error instanceof SeedConfigError) {
    console.error(`\n[ingest:charity-commission-bulk] ${error.message}\n`);
    process.exit(1);
  }
  console.error("\n[ingest:charity-commission-bulk] failed.");
  console.error(error);
  await reportError(error, { script: "run-charity-commission-bulk", env: DB_URL_VAR });
  process.exit(1);
});
