// Removes quoted email history from replies already stored in reply_events.
//
//   npm run backfill:reply-quotes              # dry run: reports what would change, writes nothing
//   npm run backfill:reply-quotes -- --apply   # rewrites reply_body
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local —
// point those at staging or production to choose the target.
//
// Gmail's text/plain part hard-wraps "On ... wrote:" across two lines, and
// stripQuotedReply used to miss that, so replies captured before the fix carry
// our own previous email underneath the client's words. New replies are
// stripped at capture (src/lib/gmail/reply-sync.ts); this sweeps the rows that
// predate it, through the same function, so there is no second implementation.
//
// What it removes is our own outgoing email, which is already stored as its own
// outreach_messages row and shown as its own card in the thread. Idempotent:
// a second run finds nothing left to strip. reply_events triggers fire on
// insert only, so a rewrite does not re-notify anyone or mark threads unread.

import { buildAdminClient } from "../src/lib/supabase/admin-client-factory.ts";
import { stripQuotedReply } from "../src/lib/gmail/reply-message.ts";

const PAGE_SIZE = 500;
const apply = process.argv.includes("--apply");

const supabase = buildAdminClient();
if (!supabase) {
  console.error(
    "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  );
  process.exit(1);
}

console.log(`Target: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(
  apply
    ? "Applying — rewriting replies that still carry quoted history.\n"
    : "Dry run — reporting what would change, writing nothing.\n",
);

let scanned = 0;
const changes: { id: string; before: number; after: number }[] = [];

for (let from = 0; ; from += PAGE_SIZE) {
  const { data, error } = await supabase
    .from("reply_events")
    .select("id, reply_body")
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (error) {
    console.error(`Could not read replies: ${error.message}`);
    process.exit(1);
  }
  const rows = (data ?? []) as { id: string; reply_body: string | null }[];

  for (const row of rows) {
    scanned += 1;
    if (!row.reply_body) continue;
    const stripped = stripQuotedReply(row.reply_body);
    if (stripped !== row.reply_body) {
      changes.push({ id: row.id, before: row.reply_body.length, after: stripped.length });
      if (apply) {
        const { error: updateError } = await supabase
          .from("reply_events")
          .update({ reply_body: stripped })
          .eq("id", row.id);
        if (updateError) {
          console.error(`Could not update reply ${row.id}: ${updateError.message}`);
          process.exit(1);
        }
      }
    }
  }

  if (rows.length < PAGE_SIZE) break;
}

// Lengths, not text: reply bodies are client correspondence and this output
// ends up in terminals and pasted into chat.
for (const change of changes) {
  console.log(`  ${change.id}  ${change.before} → ${change.after} characters`);
}
console.log(`\nReplies scanned:   ${scanned}`);
console.log(`Replies ${apply ? "cleaned" : "to clean"}: ${changes.length}`);
if (!apply && changes.length > 0) {
  console.log("\nDry run — nothing was written. Re-run with -- --apply to rewrite them.");
}
