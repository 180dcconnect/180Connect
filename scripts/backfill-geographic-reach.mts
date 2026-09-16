// Geographic-reach catch-up, run from the command line instead of the admin
// screen.
//
//   npm run backfill:reach -- --dry-run   # report only, writes nothing
//   npm run backfill:reach                # fills the gaps
//
// Same job as the "How far each charity works" card on
// /admin/charity-commission, and the same code path —
// src/lib/charity-register/reach-backfill.ts. The card is capped at
// MAX_BACKFILL per press, which is a function-timeout budget, not a data one.
// This script has no such ceiling and loops until findReachTargets reports
// nothing pending, so a backlog that would take several presses is one command.
//
// Writes geographic_reach, and data_completeness_score alongside it because the
// score counts that field. Only where reach is null — reachPatchFor returns
// nothing for a row that already has one, so a re-run is a no-op and an
// interrupted run is resumable by construction.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local,
// and data/register.sqlite present (npm run register:fetch).
//
// Runs under --conditions=react-server so that `import "server-only"` resolves
// to the marker package's empty build rather than its throwing one. The guard
// is there to keep these modules out of a client bundle; a node script is the
// server.

import { buildAdminClient } from "../src/lib/supabase/admin-client-factory.ts";
import {
  MAX_BACKFILL,
  findReachTargets,
  runReachBackfill,
} from "../src/lib/charity-register/reach-backfill.ts";

const dryRun = process.argv.includes("--dry-run");

const supabase = buildAdminClient();
if (!supabase) {
  console.error(
    "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  );
  process.exit(1);
}

const { coverage, targets } = await findReachTargets(supabase);

console.log(`Charities on the client list: ${coverage.charities}`);
console.log(`  already answered:           ${coverage.covered}`);
console.log(`  the register can fill:      ${coverage.pending}\n`);

const byReach = new Map<string, number>();
for (const target of targets) {
  const reach = target.patch.geographic_reach;
  byReach.set(reach, (byReach.get(reach) ?? 0) + 1);
}
if (byReach.size > 0) {
  console.log("Pending, by reach the register implies:");
  for (const [reach, count] of [...byReach].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(6)}  ${reach}`);
  }
  console.log("");
}

if (dryRun) {
  console.log("Dry run — nothing was written. Re-run without --dry-run to apply.");
  process.exit(0);
}

if (coverage.pending === 0) {
  console.log("Nothing to fill in — every charity already says how far it works.");
  process.exit(0);
}

let organisations = 0;
// Each pass re-reads what is still pending, so a pass that writes nothing is
// the end of the work and not a stall to keep spinning on.
for (let pass = 1; ; pass += 1) {
  const outcome = await runReachBackfill(supabase, MAX_BACKFILL);
  organisations += outcome.organisations;
  console.log(
    `  pass ${pass}: ${outcome.organisations} charities, ${outcome.remaining} remaining`,
  );
  if (outcome.organisations === 0 || outcome.remaining === 0) break;
}

console.log(`\nDone. Filled reach for ${organisations} charities.`);
