// Register-profile catch-up, run from the command line instead of the admin
// screen (F-charity-register).
//
//   npm run backfill:register-profile -- --dry-run   # report only, writes nothing
//   npm run backfill:register-profile               # fills the gaps
//
// Same job as the "Fill in register profile" button on /admin/charity-commission,
// and the same code path — src/lib/charity-register/profile-backfill.ts. The
// button exists for a CAM and is capped at MAX_BACKFILL per press, which is a
// function-timeout budget, not a data one. This script has no such ceiling and
// loops until findProfileTargets reports nothing pending, so a backlog that
// would take a dozen presses is one command.
//
// Writes only the four register-profile columns, and only where the stored
// value is null — patchFor never puts a key in the payload for a column that
// already holds something, so a re-run is a no-op and an interrupted run is
// resumable by construction.
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
  findProfileTargets,
  runProfileBackfill,
} from "../src/lib/charity-register/profile-backfill.ts";

const dryRun = process.argv.includes("--dry-run");

const supabase = buildAdminClient();
if (!supabase) {
  console.error(
    "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  );
  process.exit(1);
}

const { coverage, targets } = await findProfileTargets(supabase);

console.log(`Charities on the client list: ${coverage.charities}`);
console.log(`  already complete:           ${coverage.covered}`);
console.log(`  the register can fill:      ${coverage.pending}`);
console.log(`  field values to write:      ${coverage.pendingFields}\n`);

const byColumn = new Map<string, number>();
for (const target of targets) {
  for (const column of Object.keys(target.patch)) {
    byColumn.set(column, (byColumn.get(column) ?? 0) + 1);
  }
}
if (byColumn.size > 0) {
  console.log("Fields pending, by column:");
  for (const [column, count] of [...byColumn].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(6)}  ${column}`);
  }
  console.log("");
}

if (dryRun) {
  console.log("Dry run — nothing was written. Re-run without --dry-run to apply.");
  process.exit(0);
}

if (coverage.pending === 0) {
  console.log("Nothing to fill in — every charity already holds what the register publishes.");
  process.exit(0);
}

let organisations = 0;
let fields = 0;
// Each pass re-reads what is still pending, so a pass that writes nothing is
// the end of the work and not a stall to keep spinning on.
for (let pass = 1; ; pass += 1) {
  const outcome = await runProfileBackfill(supabase, MAX_BACKFILL);
  organisations += outcome.organisations;
  fields += outcome.fields;
  console.log(
    `  pass ${pass}: ${outcome.organisations} charities, ${outcome.fields} fields, ${outcome.remaining} remaining`,
  );
  if (outcome.organisations === 0 || outcome.remaining === 0) break;
}

console.log(`\nDone. Filled ${fields} fields across ${organisations} charities.`);
