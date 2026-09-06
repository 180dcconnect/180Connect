/**
 * /inbox — the outreach mailbox.
 *
 * Replaced a bucketed queue ("what needs me, and how long has it needed me")
 * with the Gmail-style shell the team has been reviewing: folders, category
 * tabs, a thread list and a reading pane. The queue's vocabulary did not
 * survive the change — its scope tabs and neglect buckets are gone, and the
 * shell's own folders and tabs answer the same questions.
 *
 * A thread is still one ORGANISATION's whole outreach history, because
 * outreach_messages stores no gmail_thread_id. That is what makes
 * `?thread=<organisationId>` a valid deep link from anywhere in the app — the
 * client record menu, the dashboard's reply queue, and the "View in inbox"
 * link the Introductory email card shows after a send all use it.
 *
 * Four sources, each failing soft on its own (a dead reply query must not
 * blank the sent history), then:
 *
 *   rows → buildRealInboxThreads (one thread per organisation)
 *        → mergeWithMockFill     (design fill behind the real rows)
 *        → sortInboxThreads
 *
 * Deliberately no `body` in the message query. The list renders subjects and
 * one-line snippets; selecting every email's HTML for every organisation would
 * move megabytes per request to render none of it. Bodies arrive per thread
 * from /api/inbox/[orgId]/thread when the reading pane opens one.
 *
 * Sending still never happens from this list. The reading pane's reply goes
 * through ReplyComposer → EmailReviewPanel → the approved server actions (PRD
 * §12.1), which re-check suppression, ownership, rate limits and human review
 * server-side regardless of which page called them.
 */

import { redirect } from "next/navigation";

import { GmailInboxShell } from "@/components/inbox/gmail-inbox-shell";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { MOCK_INBOX_THREADS } from "@/lib/inbox-mock-data";
import {
  buildRealInboxThreads,
  mergeWithMockFill,
  sortInboxThreads,
  type InboxContactRow,
  type InboxOrganisationRow,
  type InboxPendingRow,
} from "@/lib/inbox/real-threads";
import type { InboxMessageRow, InboxReplyRow } from "@/lib/outreach-inbox";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** PostgREST caps a response at 1000 rows, so history is paged the same way
    the dashboard pages its own reads. */
const PAGE_STEP = 1000;

type MessageListRow = InboxMessageRow & {
  send_status: string;
  scheduled_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

/**
 * Every outreach message, all four statuses, **without bodies**.
 *
 * The old queue fetched only `send_status = 'sent'`. Drafts and scheduled sends
 * have to come too now: @/lib/timeline's `buildEmailSentEntry` returns null for
 * anything unsent, so without these rows the mailbox's Drafts and Scheduled
 * folders would be permanently empty on real data.
 */
async function fetchMessages(
  supabase: SupabaseClient,
): Promise<{ data: MessageListRow[] | null; error: { message: string } | null }> {
  const all: MessageListRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("outreach_messages")
      .select(
        "id, subject, send_status, sent_at, scheduled_at, updated_at, created_at, organisation_id, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
      )
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_STEP - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as MessageListRow[]));
    if (data.length < PAGE_STEP) break;
    from += PAGE_STEP;
  }
  return { data: all, error: null };
}

/**
 * organisation_id → row count. A `head: true` count would be one query per
 * client, so this reads the key column alone and tallies in memory: one
 * column, no bodies, no joins.
 *
 * `column` differs per table because the two do not agree on how they name an
 * organisation. notes has an `organisation_id` FK; audit_log is polymorphic
 * (`target_table` + `target_id`, no FK — see the client activity tab), so its
 * organisation is `target_id` with `target_table` filtered to organisations.
 */
async function countByOrganisation(
  operation: string,
  column: "organisation_id" | "target_id",
  result: PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  }>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await result;
  if (error) {
    await reportError(error, { operation });
    return counts;
  }
  for (const row of data ?? []) {
    const key = row[column];
    if (typeof key !== "string") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actorResult = await getCurrentActor();
  if (!actorResult.ok) redirect("/login");
  const actor = actorResult.actor;

  if (!hasPermission(actor.role, "client:view")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const threadParam = Array.isArray(params.thread) ? params.thread[0] : params.thread;

  const supabase = await createClient();

  const [messageResult, replyResult, orgResult, contactResult] = await Promise.all([
    fetchMessages(supabase),
    supabase
      .from("reply_events")
      .select("id, reply_body, received_at, organisation_id, intent, contact_id")
      .order("received_at", { ascending: false }),
    supabase
      .from("organisations")
      .select(
        "id, legal_name, organisation_type, city, country_code, contact_email, sector, sub_sector, owner:users!organisations_owner_id_fkey(full_name, email)",
      ),
    supabase
      .from("contacts")
      .select("id, organisation_id, first_name, last_name, email, job_title, phone, is_primary"),
  ]);

  // Fail-soft per source: one dead query degrades the mailbox rather than
  // blanking it.
  for (const [operation, result] of [
    ["inbox.messages", messageResult],
    ["inbox.replies", replyResult],
    ["inbox.organisations", orgResult],
    ["inbox.contacts", contactResult],
  ] as const) {
    if (result.error) {
      await reportError(result.error, { operation });
    }
  }

  const messages = (messageResult.data ?? []) as MessageListRow[];
  const sent = messages.filter((row) => row.send_status === "sent");
  const pending: InboxPendingRow[] = messages
    .filter((row) => row.send_status === "draft" || row.send_status === "scheduled")
    .map((row) => ({
      id: row.id,
      organisation_id: row.organisation_id,
      subject: row.subject,
      send_status: row.send_status as "draft" | "scheduled",
      scheduled_at: row.scheduled_at,
      updated_at: row.updated_at,
      created_at: row.created_at,
    }));

  const [noteCounts, handoverCounts] = await Promise.all([
    countByOrganisation(
      "inbox.counts.notes",
      "organisation_id",
      supabase.from("notes").select("organisation_id"),
    ),
    countByOrganisation(
      "inbox.counts.handovers",
      "target_id",
      supabase
        .from("audit_log")
        .select("target_id")
        .eq("target_table", "organisations")
        .eq("action", "ownership_reassigned"),
    ),
  ]);

  const real = buildRealInboxThreads({
    messages: sent as unknown as InboxMessageRow[],
    replies: (replyResult.data ?? []) as unknown as InboxReplyRow[],
    pending,
    organisations: (orgResult.data ?? []) as unknown as InboxOrganisationRow[],
    contacts: (contactResult.data ?? []) as unknown as InboxContactRow[],
    noteCounts,
    handoverCounts,
  });

  // Design fill sits behind the real rows and never shadows one — see
  // mergeWithMockFill. Deleting @/lib/inbox-mock-data is the only work
  // removing it takes.
  const threads = sortInboxThreads(mergeWithMockFill(real, MOCK_INBOX_THREADS));

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f6f8fc] text-foreground">
      <main className="flex h-full w-full min-h-0 flex-col py-2 pr-2 sm:pr-4">
        <GmailInboxShell
          className="h-full"
          initialThreadId={threadParam ?? null}
          initialThreads={threads}
          key={threadParam ?? "inbox"}
        />
      </main>
    </div>
  );
}
