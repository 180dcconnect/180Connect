// Clears the duplicates queue of the flags nobody can answer any other way.
//
//   npm run duplicates:confirm-certain -- --reviewer you@example.org --dry-run
//   npm run duplicates:confirm-certain -- --reviewer you@example.org
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
// Point those at the environment you mean to clean: this writes decisions.
//
// ── Why this exists ──
//
// The importer used to send *every* match to /admin/duplicates, including a
// match on the registration number where the name and postcode agreed as well
// and the only difference between the two records was that one side had filed
// accounts and the other did not. Those show on the queue as "both copies
// agree", and confirming one writes nothing at all — per the migration,
// "confirming a duplicate needs no further write, the candidate correctly
// never became a second organisations row". So the press was ceremony, and a
// queue of ceremony is a queue people stop reading.
//
// `isCertainMatch` (src/lib/standardize/write-organisations.ts) now stops
// those being queued in the first place. This is the one-off for the ones
// already sitting there.
//
// ── What counts as certain, here ──
//
// Stricter than the importer's own rule, because this decides in bulk and
// nobody is looking at each pair:
//
//   1. The flag was raised on an exact charity-number match. A name-and-
//      postcode match is exactly what the queue is for and is never touched.
//   2. Not one row of the side-by-side comparison disagrees — the same
//      `comparisonRows` the screen renders, so this script and the page cannot
//      form different opinions about the same pair. A blank on one side is not
//      a disagreement there (that is the filed-accounts case); a real conflict
//      in the name, number, postcode, address, website or income band is, and
//      leaves the pair for a human.
//
// Anything it is not sure about it leaves alone. A pair it skips is a pair the
// queue still shows.
//
// ── What it writes ──
//
// The same two writes `decide_duplicate_flag` makes when an admin presses
// Confirm: the candidate row moves to `confirmed_match` with the reviewer and
// the time, and an `audit_log` row records it. It cannot call that function
// itself — the RPC reads `auth.uid()` for the reviewer and a service-role
// script has no session, which would leave the reviewer null and break the
// table's own decision-consistency constraint. So the reviewer is named on the
// command line, checked to be an admin, and written explicitly. The raw source
// records are not touched, which is what confirming means.

import { buildAdminClient } from "../src/lib/supabase/admin-client-factory.ts";
import {
  comparisonRows,
  ENTITY_MATCH_CANDIDATE_SELECT,
  toQueueRecord,
  type EntityMatchCandidateRow,
} from "../src/lib/duplicates.ts";

const NOTE =
  "Confirmed by the certain-match clean-up: matched on the charity number, with nothing disagreeing between the two records.";

const PAGE = 200;

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1]?.trim() || null;
}

const dryRun = process.argv.includes("--dry-run");
const reviewerEmail = argValue("--reviewer");

if (!reviewerEmail) {
  console.error(
    "Name the admin these decisions are recorded against:\n" +
      "  npm run duplicates:confirm-certain -- --reviewer you@example.org --dry-run",
  );
  process.exit(1);
}

const supabase = buildAdminClient();
if (!supabase) {
  console.error(
    "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  );
  process.exit(1);
}

// The reviewer has to be someone who could have pressed the button themselves.
// Writing a decision against a CAM or a viewer would put a name in the audit
// trail that the screen would never have accepted.
const { data: reviewer, error: reviewerError } = await supabase
  .from("users")
  .select("id, full_name, email, role, is_active")
  .ilike("email", reviewerEmail)
  .maybeSingle<{
    id: string;
    full_name: string | null;
    email: string;
    role: string;
    is_active: boolean;
  }>();

if (reviewerError) {
  console.error(`Could not look up ${reviewerEmail}: ${reviewerError.message}`);
  process.exit(1);
}
if (!reviewer) {
  console.error(`No user with the email ${reviewerEmail}.`);
  process.exit(1);
}
if (reviewer.role !== "admin" || !reviewer.is_active) {
  console.error(
    `${reviewer.email} is ${reviewer.is_active ? `a ${reviewer.role}` : "not active"} — ` +
      "only an active admin may decide a duplicate flag.",
  );
  process.exit(1);
}

console.log(
  dryRun
    ? `Dry run — reporting what would be confirmed as ${reviewer.full_name?.trim() || reviewer.email}, writing nothing.\n`
    : `Confirming certain matches as ${reviewer.full_name?.trim() || reviewer.email}.\n`,
);

let scanned = 0;
let certain = 0;
let confirmed = 0;
let failed = 0;
const leftForAHuman: { name: string; why: string }[] = [];

// The window steps over what it leaves behind, not over what it read: a
// confirmed row drops out of the pending set, so advancing by a whole page
// after writing would skip the rows that moved up into it.
for (let offset = 0; ; ) {
  const { data, error } = await supabase
    .from("entity_match_candidates")
    .select(ENTITY_MATCH_CANDIDATE_SELECT)
    .eq("match_status", "pending")
    .order("created_at", { ascending: true })
    .range(offset, offset + PAGE - 1)
    .overrideTypes<EntityMatchCandidateRow[], { merge: false }>();

  if (error) {
    console.error(`\nRead failed: ${error.message}`);
    process.exit(1);
  }

  const rows = data ?? [];
  if (rows.length === 0) break;

  // Rows this page left pending — either skipped, or a write that did not
  // land. They are what the next window has to step over, because the
  // confirmed ones are no longer in the pending set being paged.
  let stillPending = 0;

  for (const row of rows) {
    scanned++;
    const { name } = toQueueRecord(row);

    if (row.match_method !== "exact_charity_number") {
      leftForAHuman.push({ name, why: `matched on ${row.match_method.replace(/_/g, " ")}` });
      stillPending++;
      continue;
    }
    if (!row.candidate_organisation_id) {
      leftForAHuman.push({ name, why: "no client is linked to the flag" });
      stillPending++;
      continue;
    }

    const disagreeing = comparisonRows(row).filter((comparison) => comparison.differs);
    if (disagreeing.length > 0) {
      leftForAHuman.push({
        name,
        why: `${disagreeing.map((comparison) => comparison.label.toLowerCase()).join(", ")} disagree${
          disagreeing.length === 1 ? "s" : ""
        }`,
      });
      stillPending++;
      continue;
    }

    certain++;
    if (dryRun) {
      console.log(`  would confirm  ${name}`);
      stillPending++;
      continue;
    }

    const decidedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("entity_match_candidates")
      .update({
        match_status: "confirmed_match",
        reviewed_by_user_id: reviewer.id,
        reviewed_at: decidedAt,
        notes: NOTE,
      })
      .eq("id", row.id)
      // Still pending at the moment of the write: an admin may have answered
      // this one while the script was running, and their decision wins.
      .eq("match_status", "pending");

    if (updateError) {
      failed++;
      stillPending++;
      console.error(`  failed         ${name}: ${updateError.message}`);
      continue;
    }

    // The same audit row decide_duplicate_flag writes, so a bulk clean-up and
    // a press of Confirm read identically in the audit log — apart from the
    // note, which says which of the two this was.
    const { error: auditError } = await supabase.from("audit_log").insert({
      actor_user_id: reviewer.id,
      action: "duplicate_confirmed",
      target_table: "organisations",
      target_id: row.candidate_organisation_id,
      detail: {
        entity_match_candidate_id: row.id,
        raw_source_record_id: row.raw_source_record_id,
        note: NOTE,
      },
    });
    if (auditError) {
      // The decision is already written, so this is reported and counted
      // rather than rolled back — a decision missing its audit row is worth
      // knowing about, and re-running the script will not find this row again.
      console.error(`  audit failed   ${name}: ${auditError.message}`);
    }

    confirmed++;
    console.log(`  confirmed      ${name}`);
  }

  if (rows.length < PAGE) break;
  offset += stillPending;
  // Every row on this page was confirmed, so the next window starts where this
  // one did — stepping forward would skip the rows that have just moved up
  // into its place.
  if (stillPending === 0) offset = 0;
}

console.log(`\nPending flags read:   ${scanned}`);
console.log(`Certain matches:      ${certain}`);
console.log(`Left for a human:     ${leftForAHuman.length}`);
if (!dryRun) {
  console.log(`Confirmed:            ${confirmed}`);
  if (failed > 0) console.log(`Could not be written: ${failed}`);
}

if (leftForAHuman.length > 0) {
  console.log("\nStill on the queue:");
  for (const skipped of leftForAHuman.slice(0, 20)) {
    console.log(`  ${skipped.name} — ${skipped.why}`);
  }
  if (leftForAHuman.length > 20) {
    console.log(`  …and ${leftForAHuman.length - 20} more`);
  }
}

console.log(
  dryRun
    ? "\nDry run — nothing was written. Re-run without --dry-run to confirm these."
    : "\nDone. Each confirmation is in the audit log against the reviewer named above.",
);
