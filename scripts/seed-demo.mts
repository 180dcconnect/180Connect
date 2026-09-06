/**
 * Writes the demo scenario (src/lib/demo-scenario/fixtures.ts) to a development
 * or staging database.
 *
 *     npm run seed:demo
 *     npm run seed:demo:clear
 *
 * `npm run seed` gives the client list volume — fifty randomised organisations.
 * This gives it a *story*: fourteen named clients covering all ten pipeline
 * statuses, the actions an admin assigned against them (two of them overdue),
 * the emails sent and the replies that came back, the suggested edits waiting on
 * an approval, the notifications those events produced, and the audit trail
 * behind them. The point is that every screen has something true to show when
 * someone walks the app in front of an audience.
 *
 * Three properties, and how they hold:
 *
 *   **Reversible.** Every row is minted into the `dec0de00-0000-4000-8000-…`
 *   uuid namespace, so the clear deletes exactly the demo rows and nothing else
 *   — see the fixtures header for why `is_seed` alone could not do this job.
 *
 *   **Idempotent.** The ids are stable, so a re-run clears and re-inserts
 *   rather than stacking a second scenario on top of the first.
 *
 *   **All-or-nothing.** One transaction. A failure part-way leaves the database
 *   as it was, never holding half a story.
 *
 * Timestamps are computed from `now()` at insert time, not baked in: the
 * scenario has to still read as "overdue by six days" and "replied 21 hours
 * ago" whenever it is run, not only on the day it was written.
 *
 * Safety comes from `src/lib/seed/config.ts` unchanged — the same two guards
 * that stop `npm run seed` reaching production stop this. `pg` rather than
 * supabase-js for the same reason the seed uses it: PostgREST has no
 * multi-statement transaction, and connecting as Postgres puts RLS out of the
 * way so the deletes can run.
 */

import { Client } from "pg";
import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";
import {
  DEMO_CAST_EMAILS,
  DEMO_ID_LIKE,
  DEMO_PIPELINE_COVERAGE,
  demoActions,
  demoAuditEntries,
  demoEditSuggestions,
  demoNotes,
  demoNotifications,
  demoOrganisations,
  demoOutreachMessages,
  demoReplyEvents,
  type DemoCast,
} from "../src/lib/demo-scenario/fixtures.ts";

const UNDEFINED_TABLE = "42P01";

/** `npm run seed:demo:clear` passes this; anything else is a seed run. */
const CLEAR_ONLY = process.argv.includes("--clear");

/**
 * The deletes, in dependency order. Ordered by hand rather than trusting
 * cascade: `audit_log` and `notifications` reference a client through a bare
 * `target_id` uuid with no foreign key behind it, so dropping the organisation
 * would leave both behind pointing at nothing.
 */
const DELETES: readonly { table: string; where: string }[] = [
  { table: "public.notifications", where: `id::text like $1` },
  { table: "public.audit_log", where: `id::text like $1` },
  { table: "public.reply_events", where: `id::text like $1` },
  { table: "public.outreach_messages", where: `id::text like $1` },
  { table: "public.edit_suggestions", where: `id::text like $1` },
  { table: "public.actions", where: `id::text like $1` },
  { table: "public.notes", where: `id::text like $1` },
  { table: "public.organisations", where: `id::text like $1` },
];

async function clearDemoRows(client: Client): Promise<number> {
  let removed = 0;
  for (const { table, where } of DELETES) {
    const { rowCount } = await client.query(
      `delete from ${table} where ${where}`,
      [DEMO_ID_LIKE],
    );
    removed += rowCount ?? 0;
  }
  return removed;
}

/**
 * Resolves the cast by email. A missing account is fatal: an action with a null
 * assignee never appears on the Actions tab, which is the one thing the demo
 * most needs to show, and a scenario that half-loads is worse than one that
 * refuses to.
 */
async function resolveCast(client: Client): Promise<DemoCast> {
  const emails = Object.values(DEMO_CAST_EMAILS);
  const { rows } = await client.query<{ id: string; email: string }>(
    "select id, email from public.users where lower(email) = any($1::text[])",
    [emails.map((email) => email.toLowerCase())],
  );
  const byEmail = new Map(rows.map((row) => [row.email.toLowerCase(), row.id]));

  const missing = emails.filter((email) => !byEmail.has(email.toLowerCase()));
  if (missing.length > 0) {
    throw new SeedConfigError(
      `The demo scenario needs these accounts to exist on the target database, and they do not:\n` +
        missing.map((email) => `    ${email}`).join("\n") +
        "\n\n  Create them with `npm run seed:test-accounts`, which goes through Supabase Auth" +
        "\n  so the accounts can actually be signed in to. Inserting rows into public.users" +
        "\n  by hand produces an account with no auth identity and breaks login project-wide.",
    );
  }

  return Object.fromEntries(
    Object.entries(DEMO_CAST_EMAILS).map(([key, email]) => [
      key,
      byEmail.get(email.toLowerCase())!,
    ]),
  ) as DemoCast;
}

/** `insert into <table> (<cols>) values (…), (…)`, with bound values. */
function buildInsert(
  table: string,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      values.push(row[column]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return {
    text: `insert into ${table} (${columns.join(", ")})\nvalues ${tuples.join(",\n       ")}`,
    values,
  };
}

/** Days before now, as a timestamptz expression Postgres computes at insert. */
function daysAgo(days: number): string {
  return `now() - interval '${days} days'`;
}

async function insertOrganisations(client: Client, cast: DemoCast): Promise<number> {
  const organisations = demoOrganisations();
  const columns = [
    "id",
    "legal_name",
    "organisation_type",
    "entry_method",
    "is_verified",
    "sector",
    "city",
    "website",
    "contact_email",
    "outreach_status",
    "owner_id",
    "country_code",
    "is_seed",
  ];
  const insert = buildInsert(
    "public.organisations",
    columns,
    organisations.map((org) => ({
      ...org,
      owner_id: org.owner_key ? cast[org.owner_key] : null,
      country_code: "GB",
      // Marked as seed as well as namespaced: `npm run seed:clear` should take
      // the demo scenario with it, so "get the fake data off this database"
      // does not depend on remembering there were two commands.
      is_seed: true,
    })),
  );
  await client.query(insert.text, insert.values);

  /*
   * `updated_at` is what stall detection and the client list's "quiet for N
   * days" reading measure from, and it has a `now()` default that the insert
   * above just set — so every client would read as touched today. Backdated in
   * a second statement, per row, from the fixture's own `quiet_days`.
   *
   * created_at moves with it, further back: a client cannot have been created
   * after it was last updated.
   */
  for (const org of organisations) {
    await client.query(
      `update public.organisations
          set updated_at = ${daysAgo(org.quiet_days)},
              created_at = ${daysAgo(org.quiet_days + 30)}
        where id = $1`,
      [org.id],
    );
  }

  return organisations.length;
}

async function insertActions(client: Client, cast: DemoCast): Promise<number> {
  const actions = demoActions();
  const columns = [
    "id",
    "organisation_id",
    "assignee_user_id",
    "created_by_user_id",
    "title",
    "description",
    "status",
    "is_seed",
  ];
  const insert = buildInsert(
    "public.actions",
    columns,
    actions.map((action) => ({
      ...action,
      assignee_user_id: cast[action.assignee_key],
      created_by_user_id: cast[action.created_by_key],
      // Every row lands open, whatever it ends up as. `completed_at` is
      // computed from `now()` in the update below, and the table's
      // actions_completed_at_matches_status check rejects a completed row that
      // arrives without one — so the status has to move in the same statement
      // that sets the timestamp, not before it.
      status: "open",
      is_seed: true,
    })),
  );
  await client.query(insert.text, insert.values);

  /*
   * The dates are the whole feature here — F170 is the due date, F172 is what
   * "overdue" looks like — so they are set relative to the run rather than
   * bound as literals. `due_date` is a date column, hence `::date`.
   *
   * `remind_at` is what the F175 reminder sweep reads. Set a day before the due
   * date for anything still open with a date, so a demo that runs the sweep has
   * something ripe to find.
   */
  for (const action of actions) {
    const due =
      action.due_in_days === null ? "null" : `(${daysAgo(-action.due_in_days)})::date`;
    const remind =
      action.due_in_days === null || action.status !== "open"
        ? "null"
        : daysAgo(-(action.due_in_days - 1));
    const completed =
      action.status === "completed" ? daysAgo(Math.max(action.created_days_ago - 2, 0)) : "null";
    await client.query(
      `update public.actions
          set status = $2,
              due_date = ${due},
              remind_at = ${remind},
              completed_at = ${completed},
              created_at = ${daysAgo(action.created_days_ago)},
              updated_at = ${daysAgo(action.status === "completed" ? Math.max(action.created_days_ago - 2, 0) : action.created_days_ago)}
        where id = $1`,
      [action.id, action.status],
    );
  }

  return actions.length;
}

async function insertOutreach(client: Client, cast: DemoCast): Promise<number> {
  const messages = demoOutreachMessages();
  const insert = buildInsert(
    "public.outreach_messages",
    [
      "id",
      "organisation_id",
      "sent_by_user_id",
      "subject",
      "body",
      "send_status",
      "sent_to_email",
    ],
    messages.map((message) => ({
      ...message,
      sent_by_user_id: cast[message.sent_by_key],
      // Every row lands as a draft. outreach_messages_sent_at_matches_status
      // rejects a `sent` row with no `sent_at` (and the same for `scheduled`),
      // and the timestamps are computed from `now()` in the update below — so
      // the status moves in the statement that gives it its date.
      send_status: "draft",
    })),
  );
  await client.query(insert.text, insert.values);

  for (const message of messages) {
    const sentAt = message.sent_days_ago === null ? "null" : daysAgo(message.sent_days_ago);
    const scheduledAt =
      message.scheduled_in_days === null ? "null" : daysAgo(-message.scheduled_in_days);
    const createdDays = message.sent_days_ago ?? 0;
    await client.query(
      `update public.outreach_messages
          set send_status = $2,
              sent_at = ${sentAt},
              scheduled_at = ${scheduledAt},
              created_at = ${daysAgo(createdDays)},
              updated_at = ${daysAgo(createdDays)}
        where id = $1`,
      [message.id, message.send_status],
    );
  }

  return messages.length;
}

async function insertReplies(client: Client): Promise<number> {
  const messages = demoOutreachMessages();
  const replies = demoReplyEvents();
  const insert = buildInsert(
    "public.reply_events",
    [
      "id",
      "organisation_id",
      "outreach_message_id",
      "reply_body",
      "sentiment",
      "intent",
      "response_time_seconds",
      "received_at",
      "processed_at",
    ],
    replies.map((reply) => ({
      ...reply,
      outreach_message_id: messages[reply.outreach_message_index]?.id ?? null,
      // `received_at` has no default and is NOT NULL, so unlike the other
      // timestamps in this script it cannot wait for the update below. A
      // placeholder now, moved to its real position in the same transaction.
      received_at: new Date(),
      // reply_events_classified_after_processing: a row may only carry a
      // sentiment and an intent once it has been processed, so the two travel
      // together on the insert rather than being backdated separately.
      processed_at: new Date(),
    })),
  );
  await client.query(insert.text, insert.values);

  for (const reply of replies) {
    await client.query(
      `update public.reply_events
          set received_at = ${daysAgo(reply.received_days_ago)},
              processed_at = ${daysAgo(reply.received_days_ago)},
              created_at = ${daysAgo(reply.received_days_ago)}
        where id = $1`,
      [reply.id],
    );
  }

  return replies.length;
}

async function insertEditSuggestions(client: Client, cast: DemoCast): Promise<number> {
  const suggestions = demoEditSuggestions();
  const insert = buildInsert(
    "public.edit_suggestions",
    [
      "id",
      "organisation_id",
      "field_name",
      "current_value",
      "proposed_value",
      "status",
      "requested_by",
      "reason",
    ],
    suggestions.map((suggestion) => ({
      ...suggestion,
      status: "pending",
      requested_by: cast[suggestion.requested_by_key],
    })),
  );
  await client.query(insert.text, insert.values);

  for (const suggestion of suggestions) {
    await client.query(
      `update public.edit_suggestions
          set created_at = ${daysAgo(suggestion.created_days_ago)},
              updated_at = ${daysAgo(suggestion.created_days_ago)}
        where id = $1`,
      [suggestion.id],
    );
  }

  return suggestions.length;
}

async function insertNotifications(client: Client, cast: DemoCast): Promise<number> {
  const notifications = demoNotifications();
  const insert = buildInsert(
    "public.notifications",
    [
      "id",
      "recipient_user_id",
      "actor_user_id",
      "notification_type",
      "title",
      "body",
      "link_path",
      "created_at",
    ],
    notifications.map((notification) => ({
      ...notification,
      recipient_user_id: cast[notification.recipient_key],
      actor_user_id: notification.actor_key ? cast[notification.actor_key] : null,
      // guard_notification_read_state() rejects an UPDATE that touches
      // anything but read_at — a notification is a record of something that
      // happened and is not editable after the fact. So `created_at` is set on
      // the way in, computed here rather than in SQL.
      created_at: new Date(Date.now() - notification.received_hours_ago * 3_600_000),
    })),
  );
  await client.query(insert.text, insert.values);

  // read_at is the one column the guard does allow to move.
  for (const notification of notifications) {
    if (!notification.read) continue;
    await client.query(
      `update public.notifications
          set read_at = now() - interval '${notification.received_hours_ago} hours'
        where id = $1`,
      [notification.id],
    );
  }

  return notifications.length;
}

async function insertAudit(client: Client, cast: DemoCast): Promise<number> {
  const entries = demoAuditEntries();

  /*
   * `ownership_reassigned` carries the outgoing and incoming CAM as bare uuids
   * in `detail.from`/`detail.to` (the timeline resolves them to names by hand —
   * see collectReferencedUserIds). The fixtures leave both null because they
   * cannot know the ids; they are filled in here from the resolved cast.
   */
  const resolved = entries.map((entry) => {
    if (entry.action !== "ownership_reassigned") return entry;
    return {
      ...entry,
      detail: { ...entry.detail, from: cast.camTwo, to: cast.cam },
    };
  });

  const insert = buildInsert(
    "public.audit_log",
    ["id", "actor_user_id", "action", "target_table", "target_id", "detail"],
    resolved.map((entry) => ({
      ...entry,
      actor_user_id: entry.actor_key ? cast[entry.actor_key] : null,
      target_table: "organisations",
      target_id: entry.organisation_id,
      detail: JSON.stringify(entry.detail),
    })),
  );
  await client.query(insert.text, insert.values);

  for (const entry of resolved) {
    await client.query(
      `update public.audit_log set created_at = ${daysAgo(entry.created_days_ago)} where id = $1`,
      [entry.id],
    );
  }

  return resolved.length;
}

async function insertNotes(client: Client, cast: DemoCast): Promise<number> {
  const notes = demoNotes();
  const insert = buildInsert(
    "public.notes",
    ["id", "organisation_id", "author_id", "content"],
    notes.map((note) => ({ ...note, author_id: cast[note.author_key] })),
  );
  await client.query(insert.text, insert.values);

  for (const note of notes) {
    await client.query(
      `update public.notes
          set created_at = ${daysAgo(note.created_days_ago)},
              updated_at = ${daysAgo(note.created_days_ago)}
        where id = $1`,
      [note.id],
    );
  }

  return notes.length;
}

async function main(): Promise<void> {
  // Throws SeedRefusedError against production, SeedConfigError when unconfigured.
  const config = resolveSeedConfig(process.env);
  const label = CLEAR_ONLY ? "seed:demo:clear" : "seed:demo";
  console.log(`[${label}] target: ${config.target}`);

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    await client.query("begin");

    const removed = await clearDemoRows(client);
    if (CLEAR_ONLY) {
      await client.query("commit");
      console.log(`[${label}] removed ${removed} demo rows`);
      return;
    }

    const cast = await resolveCast(client);

    const counts = {
      organisations: await insertOrganisations(client, cast),
      actions: await insertActions(client, cast),
      emails: await insertOutreach(client, cast),
      replies: await insertReplies(client),
      suggestions: await insertEditSuggestions(client, cast),
      notifications: await insertNotifications(client, cast),
      audit: await insertAudit(client, cast),
      notes: await insertNotes(client, cast),
    };

    await client.query("commit");

    console.log(`[${label}] cleared ${removed} rows from a previous run`);
    for (const [what, count] of Object.entries(counts)) {
      console.log(`[${label}]   ${what.padEnd(14)} ${count}`);
    }
    console.log(
      `[${label}] pipeline statuses covered: ${DEMO_PIPELINE_COVERAGE.length}/10`,
    );
    console.log(`[${label}] see docs/demo-runbook.md for the walkthrough`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(async (error: unknown) => {
  if (error instanceof SeedRefusedError) {
    console.error(`\n[seed:demo] ${error.message}\n`);
    process.exit(1);
  }

  if (error instanceof SeedConfigError) {
    console.error(`\n[seed:demo] ${error.message}\n`);
    await reportError(error, { script: "seed-demo", env: DB_URL_VAR });
    process.exit(1);
  }

  const isMissingTable =
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === UNDEFINED_TABLE;

  if (isMissingTable) {
    console.error(
      "\n[seed:demo] a table the scenario writes to does not exist in the target database.\n" +
        "  Apply the migrations first — see supabase/MIGRATIONS.md:\n" +
        "    supabase db push        # against a linked project\n" +
        "    supabase migration up   # against the local stack\n",
    );
  } else {
    console.error(
      "\n[seed:demo] failed — no rows were written. The transaction was rolled back.",
    );
    console.error(error);
  }

  await reportError(error, { script: "seed-demo", env: DB_URL_VAR });
  process.exit(1);
});
