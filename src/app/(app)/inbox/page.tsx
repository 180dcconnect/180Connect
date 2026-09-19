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
 *        → sortInboxThreads
 *
 * Deliberately no `body` in the message query. The list renders subjects and
 * one-line snippets; selecting every email's HTML for every organisation would
 * move megabytes per request to render none of it. Bodies arrive per thread
 * from /api/inbox/[orgId]/thread when the reading pane opens one.
 *
 * Deliberately not every organisation either. Only organisations with outreach
 * on them become threads, so only those are read — in a second round, once the
 * messages and replies say which they are. Compose's full recipient directory
 * (every client with an address, thousands of rows) arrives from
 * /api/inbox/directory when a compose window first opens, instead of on every
 * load and every realtime refresh of this page.
 *
 * Sending still never happens from this list. The reading pane's reply goes
 * through ReplyComposer → EmailReviewPanel → the approved server actions (PRD
 * §12.1), which re-check suppression, ownership, rate limits and human review
 * server-side regardless of which page called them.
 */

import { redirect } from "next/navigation";

import { RecordOnboardingStep } from "@/components/record-onboarding-step";
import { GmailInboxShell } from "@/components/inbox/gmail-inbox-shell";
import { InboxRealtimeRefresher } from "@/components/inbox/inbox-realtime-refresher";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { getOutreachEngineHealth } from "@/lib/gmail/engine-status.ts";
import { emailField, safeValidate } from "@/lib/validation";
import {
  parseCategoryTabParam,
  tabForThreadStatus,
} from "@/lib/inbox/category-tabs.ts";
import { INBOX_CONTACT_SELECT, INBOX_ORG_SELECT } from "@/lib/inbox/inbox-selects";
import {
  buildAddressableClients,
  buildRealInboxThreads,
  sortInboxThreads,
  type InboxContactRow,
  type InboxOrganisationRow,
  type InboxPendingRow,
} from "@/lib/inbox/real-threads";
import type { InboxThreadStateRow } from "@/lib/inbox/thread-flags";
import { DEFAULT_FOLLOW_UP_THRESHOLDS } from "@/lib/outreach/follow-up-recommendations";
import type { InboxMessageRow, InboxReplyRow } from "@/lib/outreach-inbox";
import type { InboxThreadTag } from "@/lib/inbox-thread-view";
import { fetchPaged, fetchPagedForOrgs } from "@/lib/supabase/fetch-paged";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

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
 * Every whole-table read on this page needs this, not only the messages one.
 * The mailbox assembles a thread from several tables at once, so an unpaged
 * `select` does not lose the 1001st row quietly — it loses that client's
 * thread, with a full-looking inbox as the only symptom.
 *
 * `order` is passed in because a paged read needs a stable sort to page
 * against: without one, PostgREST may return the same row on two pages and
 * skip another. The loop is the shared `fetchPaged`; this only widens the row
 * type, because these selects embed relations the generated types do not model.
 */
function fetchAllPages<T>(
  buildPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  pagesPerRound = 4,
) {
  return fetchPaged<T>(
    buildPage as (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    { pagesPerRound },
  );
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
 * column, no bodies, no joins. Paged through the 1000-row window like every
 * other whole-table read here — a single select would silently truncate past
 * 1000 rows and undercount badges at scale.
 *
 * `column` differs per table because the two do not agree on how they name an
 * organisation. notes has an `organisation_id` FK; audit_log is polymorphic
 * (`target_table` + `target_id`, no FK — see the client activity tab), so its
 * organisation is `target_id` with `target_table` filtered to organisations.
 */
async function countByOrganisation(
  operation: string,
  column: "organisation_id" | "target_id",
  buildPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  }>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await fetchPaged<Record<string, unknown>>(buildPage, {
    pagesPerRound: 4,
  });
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
  // ?to= carries the client record's on-file address alongside ?compose=, so
  // the composer opens addressed even when the id resolves to nothing in the
  // directory below (seed rows are excluded from it by design). Display hint
  // only: anything not shaped like an address is ignored, and the compose
  // window's own save/send gates still decide what can actually leave.
  const toParam = Array.isArray(params.to) ? params.to[0] : params.to;
  const toTrimmed = toParam?.trim().slice(0, 254) ?? "";
  const composeRecipient = safeValidate(emailField(), toTrimmed).success ? toTrimmed : null;
  // ?tab=<category> pins the tab bar (and survives refresh and shares, because
  // the shell writes it back on every tab click). Unknown values are ignored
  // rather than matching nothing.
  const tabParamRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const explicitTab = parseCategoryTabParam(tabParamRaw);

  const supabase = await createClient();

  // Live outreach-engine checks for the sidebar's status card: Gmail transport
  // (caps itself at ~6s) plus the reply-sync / scheduled-send pg_cron jobs.
  // Started now and handed to the shell unawaited — the card streams its rows
  // in when the checks finish, so a slow Gmail no longer holds the whole
  // mailbox open. getOutreachEngineHealth never rejects: each check degrades
  // to its own X instead.
  const engineHealth = getOutreachEngineHealth(supabase);

  // Round one: every read that does not depend on which organisations have
  // outreach on them, all in flight together.
  const [
    messageResult,
    replyResult,
    orgTagResult,
    tagResult,
    noteCounts,
    handoverCounts,
    preferences,
    threadState,
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
    // Tags on organisations (ORG_TAGS, F191). Kept out of the core queries
    // because a thread with no tags is the common case and this is one cheap
    // join. Shared-read under RLS.
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
    countByOrganisation("inbox.counts.notes", "organisation_id", (from, to) =>
      supabase
        .from("notes")
        .select("organisation_id")
        .order("organisation_id", { ascending: true })
        .range(from, to),
    ),
    countByOrganisation("inbox.counts.handovers", "target_id", (from, to) =>
      supabase
        .from("audit_log")
        .select("target_id")
        .eq("target_table", "organisations")
        .eq("action", "ownership_reassigned")
        .order("target_id", { ascending: true })
        .range(from, to),
    ),
    // F160: the viewer's own first-follow-up threshold drives the Follow-Up Due
    // tab, so it agrees with the dashboard's Needs Attention panel rather than
    // assuming the AC default for everyone.
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

  const messages = (messageResult.data ?? []) as MessageListRow[];
  const replies = (replyResult.data ?? []) as unknown as InboxReplyRow[];
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

  // Round two: the organisations the mailbox actually shows — every one with a
  // sent, drafted, scheduled or replied-to message — plus the ?compose= target,
  // whose row opens the composer addressed. Their contacts come with them.
  //
  // Seed rows are not filtered out here: buildRealInboxThreads never makes a
  // thread of one, and buildAddressableClients admits one only when it is the
  // ?compose= target named below — the narrow exception a deep link from a seed
  // record needs to open addressed.
  const composeTargetId = composeParam && isUuid(composeParam) ? composeParam : null;
  const mailboxOrganisationIds = [
    ...new Set(
      [
        ...messages.map((row) => row.organisation_id),
        ...replies.map((row) => row.organisation_id),
        ...(composeTargetId ? [composeTargetId] : []),
      ].filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const [orgResult, contactResult] = await Promise.all([
    fetchPagedForOrgs<InboxOrganisationRow>(mailboxOrganisationIds, (ids, from, to) =>
      supabase
        .from("organisations")
        .select(INBOX_ORG_SELECT)
        .in("id", ids)
        .order("id", { ascending: true })
        .range(from, to)
        .overrideTypes<InboxOrganisationRow[], { merge: false }>(),
    ),
    fetchPagedForOrgs<InboxContactRow>(mailboxOrganisationIds, (ids, from, to) =>
      supabase
        .from("contacts")
        .select(INBOX_CONTACT_SELECT)
        .in("organisation_id", ids)
        .order("id", { ascending: true })
        .range(from, to)
        .overrideTypes<InboxContactRow[], { merge: false }>(),
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

  const orgRows = orgResult.data ?? [];
  const contactRows = contactResult.data ?? [];

  const real = buildRealInboxThreads({
    messages: sent as unknown as InboxMessageRow[],
    replies,
    pending,
    organisations: orgRows,
    contacts: contactRows,
    noteCounts,
    handoverCounts,
    orgTags,
  });

  const threads = sortInboxThreads(real);

  // The tab the shell mounts on. An explicit ?tab= wins; otherwise a deep link
  // (?thread=, e.g. from the dashboard reply queue or a notification) lands on
  // the queue its thread belongs to, so Back returns to Inbound/Awaiting
  // instead of stranding the CAM on Primary. Anything else is Primary, which
  // shows everything and can never hide the opened thread.
  const initialTab =
    explicitTab ??
    (threadParam
      ? tabForThreadStatus(threads.find((thread) => thread.id === threadParam)?.status)
      : "primary");

  // The recipients Compose can resolve before its full directory arrives: the
  // mailbox's own organisations plus the ?compose= target. That is what lets a
  // "Write to this client" deep link open already addressed. The shell swaps in
  // every addressable client from /api/inbox/directory once a composer opens.
  const addressableClients = buildAddressableClients({
    organisations: orgRows,
    contacts: contactRows,
    includeSeedIds: composeTargetId ? [composeTargetId] : [],
  });

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f6f8fc] text-foreground">
      {actor.role === "viewer" && <RecordOnboardingStep step="view_inbox" />}
      <main className="flex h-full w-full min-h-0 flex-col py-2 pr-2 sm:pr-4">
        <InboxRealtimeRefresher />
        <GmailInboxShell
          className="h-full"
          followUpDays={
            preferences.data?.first_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.first
          }
          initialThreadId={threadParam ?? null}
          initialComposeClientId={composeParam ?? null}
          initialComposeRecipient={composeRecipient}
          initialTab={initialTab}
          viewerEmail={actor.email}
          viewerIsAdmin={actor.role === "admin"}
          viewerId={actor.id}
          viewerRole={actor.role}
          initialThreadFlags={threadFlags}
          addressableClients={addressableClients}
          initialThreads={threads}
          initialTags={allTags}
          engineHealth={engineHealth}
          // No key. It used to be `${thread}:${compose}`, but the shell writes
          // ?thread= into the URL itself (replaceState) as threads open, so the
          // next router.refresh rendered a new key and remounted the whole
          // mailbox — closing any open compose window and, with a leftover
          // ?compose= still in the URL, opening a fresh one on top of the
          // thread. The shell follows these params with effects instead.
        />
      </main>
    </div>
  );
}
