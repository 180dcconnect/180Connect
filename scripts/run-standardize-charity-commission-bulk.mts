/**
 * Promotes bulk register extract records into ORGANISATIONS.
 *
 *     npm run standardize:run-charity-commission-bulk
 *
 * Second half of the bulk import; run it after
 * `npm run ingest:charity-commission-bulk`. Split for the same reason every
 * other source splits it: ingestion and promotion fail for different reasons,
 * and a promote bug should be re-runnable without re-downloading 100MB.
 *
 * Idempotent: it reads raw_source_records still marked 'pending', and a promoted
 * record is marked 'validated' in the same transaction as its insert.
 */

import { reportError } from "../src/lib/error-logging.ts";
import { promotePendingCharityCommissionBulkRecords } from "../src/lib/standardize/write-organisations.ts";

async function main(): Promise<void> {
  const counts = await promotePendingCharityCommissionBulkRecords();

  console.log(
    `[standardize:charity-commission-bulk] read ${counts.read}, ` +
      `inserted ${counts.inserted}, flagged ${counts.flagged}, ` +
      `rejected ${counts.rejected}, failed ${counts.failed}`,
  );
  console.log(
    "    Next: npm run backfill:scores — the size and sector factors have real\n" +
      "    inputs for these clients now, and will stay neutral until a rescore.",
  );
}

main().catch(async (error: unknown) => {
  console.error("\n[standardize:charity-commission-bulk] failed.");
  console.error(error);
  await reportError(error, { script: "run-standardize-charity-commission-bulk" });
  process.exit(1);
});
