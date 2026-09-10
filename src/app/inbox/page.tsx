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
import { mockFillThreads } from "@/lib/inbox-mock-data";
import {
  buildAddressableClients,
  buildRealInboxThreads,
  mergeWithMockFill,
  sortInboxThreads,
  type InboxContactRow,
  type InboxOrganisationRow,
  type InboxPendingRow,
} from "@/lib/inbox/real-threads";
import type { InboxThreadStateRow } from "@/lib/inbox/thread-flags";
import { DEFAULT_FOLLOW_UP_THRESHOLDS } from "@/lib/outreach/follow-up-recommendations";
import type { InboxMessageRow, InboxReplyRow } from "@/lib/outreach-inbox";
import type { InboxThreadTag } from "@/lib/inbox-thread-view";
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

/** One ORG_TAGS row with its TAGS parent embedded. PostgREST returns the
    to-one relation as an object, but the generated types widen it to
    object-or-array, so both are handled where this is read. */
type OrgTagJoinRow = {
  organisation_id: string;
  tag:
    | { id: string; name: string; colour: string | null }
    | { id: string; name: string; colour: string | null }[]
    | null;
};

/** One TAGS row. Read whole so a tag created but not yet assigned to any
    organisation still shows as a sidebar label — `org_tags` alone would drop
    it the moment the page re-renders. */
type TagRow = { id: string; name: string; colour: string | null };

/** organisation_id → its tags, from the org_tags join. The sidebar's full
    label list comes from the TAGS read instead (see above). */
function collectOrgTags(
  rows: readonly OrgTagJoinRow[],
): Map<string, InboxThreadTag[]> {
  const byOrganisation = new Map<string, InboxThreadTag[]>();

  for (const row of rows) {
    const parent = Array.isArray(row.tag) ? row.tag[0] : row.tag;
    if (!parent?.id || !parent.name) continue;
    const tag: InboxThreadTag = {
      id: parent.id,
      name: parent.name,
      colour: parent.colour ?? null,
    };
    const existing = byOrganisation.get(row.organisation_id);
    if (existing) existing.push(tag);
    else byOrganisation.set(row.organisation_id, [tag]);
  }

  return byOrganisation;
}

/**
 * Reads a whole table through PostgREST's 1000-row window.
 *
 * Every read on this page needs this, not only the messages one. The mailbox
 * assembles a thread from four tables at once and drops any thread whose
 * *organisation* row is missing (see buildInboxThreads) — so an unpaged
 * `select` on `organisations` does not lose the 1001st client's name, it loses
 * that client's mailbox entirely, silently, with a full-looking inbox as the
 * only symptom. Same for `contacts` and `reply_events`.
 *
 * `order` is passed in because a paged read needs a stable sort to page
 * against: without one, PostgREST may return the same row on two pages and
 * skip another.
 */
async function fetchAllPages<T>(
  buildPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildPage(from, from + PAGE_STEP - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_STEP) break;
    from += PAGE_STEP;
  }
  return { data: all, error: null };
}

/**
 * Every outreach message, all four statuses, **without bodies**.
 *
 * The old queue fetched only `send_status = 'sent'`. Drafts and scheduled sends
 * have to come too now: @/lib/timeline's `buildEmailSentEntry` returns null for
 * anything unsent, so without these rows the mailbox's Drafts and Scheduled
 * folders would be permanently empty on real data.
 */
function fetchMessages(supabase: SupabaseClient) {
  return fetchAllPages<MessageListRow>((from, to) =>
    supabase
      .from("outreach_messages")
      .select(
        "id, subject, send_status, sent_at, scheduled_at, updated_at, created_at, organisation_id, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
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
  // ?compose=<organisation id> opens a compose window already addressed to that
  // client — the client record's "Write to this client" link, so composing is
  // one click from research without the record needing a composer of its own.
  const composeParam = Array.isArray(params.compose) ? params.compose[0] : params.compose;

  const supabase = await createClient();

  const [
    messageResult,
    replyResult,
    orgResult,
    contactResult,
    orgTagResult,
    tagResult,
  ] = await Promise.all([
    fetchMessages(supabase),
    fetchAllPages<InboxReplyRow>((from, to) =>
      supabase
        .from("reply_events")
        .select("id, reply_body, received_at, organisation_id, intent, contact_id")
        .order("received_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<InboxOrganisationRow>((from, to) =>
      supabase
        .from("organisations")
        .select(
          "id, legal_name, organisation_type, city, country_code, contact_email, sector, sub_sector, owner:users!organisations_owner_id_fkey(full_name, email)",
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<InboxContactRow>((from, to) =>
      supabase
        .from("contacts")
        .select("id, organisation_id, first_name, last_name, email, job_title, phone, is_primary")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Tags on organisations (ORG_TAGS, F191). Kept out of the four core
    // queries above because a thread with no tags is the common case and this
    // is one cheap join. Shared-read under RLS.
    fetchAllPages<OrgTagJoinRow>((from, to) =>
      supabase
        .from("org_tags")
        .select("organisation_id, tag:tags(id, name, colour)")
        .order("organisation_id", { ascending: true })
        .range(from, to),
    ),
    // Every tag (F188), for the sidebar's label rows — including ones not yet
    // assigned to any organisation.
    fetchAllPages<TagRow>((from, to) =>
      supabase
        .from("tags")
        .select("id, name, colour")
        .order("name", { ascending: true })
        .range(from, to),
    ),
  ]);

  // Fail-soft per source: one dead query degrades the mailbox rather than
  // blanking it.
  for (const [operation, result] of [
    ["inbox.messages", messageResult],
    ["inbox.replies", replyResult],
    ["inbox.organisations", orgResult],
    ["inbox.contacts", contactResult],
    ["inbox.org_tags", orgTagResult],
    ["inbox.tags", tagResult],
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

  // F160: the viewer's own first-follow-up threshold drives the Follow-Up Due
  // tab, so it agrees with the dashboard's Needs Attention panel rather than
  // assuming the AC default for everyone.
  const [noteCounts, handoverCounts, preferences, threadState] = await Promise.all([
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
    supabase
      .from("outreach_preferences")
      .select("first_follow_up_days")
      .eq("user_id", actor.id)
      .maybeSingle<{ first_follow_up_days: number | null }>(),
    // This viewer's own star / read / trash flags. No `.eq("user_id", ...)`
    // is needed — inbox_thread_state's SELECT policy matches own rows only
    // (matrix §3.25) — but it is stated anyway so the query says out loud
    // what it expects back, and so a policy regression shows up as no rows
    // rather than as another CAM's mailbox.
    supabase
      .from("inbox_thread_state")
      .select("organisation_id, is_starred, read_state, is_trashed")
      .eq("user_id", actor.id)
      .returns<InboxThreadStateRow[]>(),
  ]);
  if (preferences.error) {
    await reportError(preferences.error, { operation: "inbox.follow_up_preferences" });
  }
  if (threadState.error) {
    await reportError(threadState.error, { operation: "inbox.thread_state" });
  }
  // Fails soft, like every other read on this page: with no flags the mailbox
  // renders the server's own derivation, which is the same thing a CAM who has
  // never starred anything sees.
  const threadFlags = threadState.data ?? [];

  const orgTags = collectOrgTags(
    (orgTagResult.data ?? []) as unknown as OrgTagJoinRow[],
  );
  const allTags: InboxThreadTag[] = ((tagResult.data ?? []) as unknown as TagRow[])
    .filter((row) => row.id && row.name?.trim())
    .map((row) => ({ id: row.id, name: row.name, colour: row.colour ?? null }));

  const real = buildRealInboxThreads({
    messages: sent as unknown as InboxMessageRow[],
    replies: (replyResult.data ?? []) as unknown as InboxReplyRow[],
    pending,
    organisations: (orgResult.data ?? []) as unknown as InboxOrganisationRow[],
    contacts: (contactResult.data ?? []) as unknown as InboxContactRow[],
    noteCounts,
    handoverCounts,
    orgTags,
  });

  // Design fill sits behind the real rows and never shadows one — see
  // mergeWithMockFill. Clearing it takes no code change: set
  // NEXT_PUBLIC_INBOX_MOCK_FILL=0 and restart, and mockFillThreads() is [].
  const threads = sortInboxThreads(mergeWithMockFill(real, mockFillThreads()));

  // Who Compose may write to. Every organisation with an address, NOT just the
  // ones with outreach history — `real` excludes an organisation nobody has
  // emailed, which is exactly the client a first email is being written to.
  const addressableClients = buildAddressableClients({
    organisations: (orgResult.data ?? []) as unknown as InboxOrganisationRow[],
    contacts: (contactResult.data ?? []) as unknown as InboxContactRow[],
  });

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f6f8fc] text-foreground">
      <main className="flex h-full w-full min-h-0 flex-col py-2 pr-2 sm:pr-4">
        <GmailInboxShell
          className="h-full"
          followUpDays={
            preferences.data?.first_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.first
          }
          initialThreadId={threadParam ?? null}
          initialComposeClientId={composeParam ?? null}
          initialThreadFlags={threadFlags}
          addressableClients={addressableClients}
          initialThreads={threads}
          initialTags={allTags}
          key={`${threadParam ?? "inbox"}:${composeParam ?? ""}`}
        />
      </main>
    </div>
  );
}
