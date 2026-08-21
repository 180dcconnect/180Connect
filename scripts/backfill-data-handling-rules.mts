// Applies the active data handling rules to rows already in raw_source_records (F246).
//
//   npm run backfill:data-handling-rules -- --dry-run   # report only, writes nothing
//   npm run backfill:data-handling-rules                # rewrites stored payloads
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
//
// The real pass is destructive in one direction: a stripped field is gone from
// the platform and only recoverable by re-fetching from the source API. Run the
// dry run first and read the field counts before running it for real.

import { buildAdminClient } from "../src/lib/supabase/admin-client-factory.ts";
import { backfillDataHandlingRules } from "../src/lib/ingestion/backfill.ts";

const dryRun = process.argv.includes("--dry-run");

const supabase = buildAdminClient();
if (!supabase) {
  console.error(
    "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  );
  process.exit(1);
}

console.log(
  dryRun
    ? "Dry run — reporting what would change, writing nothing.\n"
    : "Applying data handling rules to existing records. This rewrites stored payloads.\n",
);

const summary = await backfillDataHandlingRules(supabase, {
  dryRun,
  onProgress(scanned, total) {
    console.log(`  scanned ${scanned}/${total}`);
  },
});

console.log(`\nRule version:        ${summary.ruleVersion}`);
console.log(`Rows scanned:        ${summary.scanned}`);
console.log(`Rows already current:${String(summary.alreadyCurrent).padStart(4)}`);
console.log(`Rows stripped:       ${summary.stripped}`);

const fields = Object.entries(summary.fieldCounts).sort((a, b) => b[1] - a[1]);
if (fields.length === 0) {
  console.log("\nNo denied fields found in stored payloads.");
} else {
  console.log("\nFields stripped:");
  for (const [path, count] of fields) {
    console.log(`  ${count.toString().padStart(6)}  ${path}`);
  }
}

if (dryRun) {
  console.log("\nDry run — nothing was written. Re-run without --dry-run to apply.");
} else {
  console.log("\nDone. One audit_log row recorded for this pass.");
}
