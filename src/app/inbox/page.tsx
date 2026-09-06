/**
 * /inbox — the outreach queue.
 *
 * Not a mailbox. The question this page answers is "what needs me, and how
 * long has it needed me", so it opens on the signed-in CAM's own clients and
 * sorts by neglect rather than by arrival. The buckets and their order live in
 * @/lib/inbox-queue; this route only fetches and hands over.
 *
 * Three sources, each failing soft on its own (a dead reply query must not
 * blank the sent history), then:
 *
 *   rows → buildInboxThreads (one thread per organisation, F075/F076 vocabulary)
 *        → buildInboxQueue   (bucket, ownership, days waiting)
 *
 * Filtering is server-side and lives in the URL (`?scope=`, `?bucket=`), the
 * same choice /clients made with `?owner=`: it survives a refresh and a paste
 * into Slack, and it keeps the filter next to the rows rather than shipping the
 * whole queue to the browser to hide most of it.
 *
 * Read-only by design. Every send goes through the approved path — the thread's
 * reply drawer, behind preflight, ownership conflict and human review — so the
 * only interactive thing on this page is a link.
 */

import { redirect } from "next/navigation";

import { Stage, Group, Rise } from "@/components/dashboard-stage";
import { InboxScopeTabs } from "@/components/inbox/inbox-scope-tabs";
import { QueueList } from "@/components/inbox/queue-list";
import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { BUCKET_HINT, bucketLabel } from "@/lib/inbox-labels";
import {
  buildInboxQueue,
  countByBucket,
  countByScope,
  filterByBucket,
  filterByScope,
  parseBucket,
  parseScope,
  sortQueueRows,
  INBOX_BUCKETS,
  type InboxQueueRow,
} from "@/lib/inbox-queue";
// TEMPORARY — design fill while the queue's visual language is being settled.
// Delete this import and the single merge below to remove every trace of it.
import { mockQueueRows } from "@/lib/inbox-mock-data";
import {
  buildInboxThreads,
  type InboxMessageRow,
  type InboxReplyRow,
} from "@/lib/outreach-inbox";
import {
  followUpRecommendations,
  DEFAULT_FOLLOW_UP_THRESHOLDS,
  FOLLOW_UP_TRIGGER_STATUSES,
  type FollowUpRecommendation,
} from "@/lib/outreach/follow-up-recommendations";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Fetch cap — all sent messages ever. PostgREST caps a response at 1000 rows,
 * so the history is paged the same way the dashboard pages its own reads.
 */
async function fetchAllSent(
  supabase: SupabaseClient,
): Promise<{ data: InboxMessageRow[] | null; error: { message: string } | null }> {
  const all: InboxMessageRow[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("outreach_messages")
      .select(
        "id, subject, send_status, sent_at, organisation_id, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
      )
      .eq("send_status", "sent")
      .order("sent_at", { ascending: false })
      .range(from, from + step - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as InboxMessageRow[]));
    if (data.length < step) break;
    from += step;
  }
  return { data: all, error: null };
}

type OrganisationRow = {
  id: string;
  legal_name: string;
  owner_id: string | null;
  outreach_status: string;
};

/**
 * F160 recommendations for the clients that actually have threads.
 *
 * Same assembly the dashboard uses (`get_clients_last_activity` + the actor's
 * own thresholds), narrowed to organisations already on this page: the queue
 * only ever decorates a thread, so measuring silence for a client with no
 * outreach at all would be work nobody reads. Fails soft to an empty list —
 * losing the follow-up badge is survivable, losing the queue is not.
 */
async function fetchFollowUps(
  supabase: SupabaseClient,
  actorId: string,
  organisations: readonly OrganisationRow[],
): Promise<FollowUpRecommendation[]> {
  const candidates = organisations
    .filter((row) => FOLLOW_UP_TRIGGER_STATUSES.has(row.outreach_status))
    .map((row) => ({
      id: row.id,
      legal_name: row.legal_name,
      outreach_status: row.outreach_status,
    }));
  if (candidates.length === 0) return [];

  const [preferences, activity] = await Promise.all([
    supabase
      .from("outreach_preferences")
      .select("first_follow_up_days, second_follow_up_days")
      .eq("user_id", actorId)
      .maybeSingle(),
    supabase.rpc("get_clients_last_activity", {
      p_organisation_ids: candidates.map((row) => row.id),
    }),
  ]);

  if (preferences.error) {
    await reportError(preferences.error, { operation: "inbox.follow_up_preferences" });
  }
  if (activity.error) {
    await reportError(activity.error, { operation: "inbox.follow_up_activity" });
    return [];
  }

  const activityByOrganisation = new Map(
    ((activity.data ?? []) as {
      organisation_id: string;
      last_email_sent_at: string | null;
      last_reply_received_at: string | null;
      last_status_change_at: string | null;
    }[]).map((row) => [
      row.organisation_id,
      {
        lastEmailSentAt: row.last_email_sent_at,
        lastReplyReceivedAt: row.last_reply_received_at,
        lastStatusChangeAt: row.last_status_change_at,
      },
    ]),
  );

  return followUpRecommendations(candidates, activityByOrganisation, {
    first: preferences.data?.first_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.first,
    second: preferences.data?.second_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.second,
  });
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
  const asParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const scope = parseScope(asParam(params.scope));
  const bucket = parseBucket(asParam(params.bucket));

  const supabase = await createClient();

  const [sentResult, replyResult, orgResult] = await Promise.all([
    fetchAllSent(supabase),
    supabase
      .from("reply_events")
      .select("id, reply_body, received_at, organisation_id, intent")
      .order("received_at", { ascending: false }),
    supabase.from("organisations").select("id, legal_name, owner_id, outreach_status"),
  ]);

  // Fail-soft per source: one dead query degrades the page rather than blanking it.
  for (const [source, result] of [
    ["inbox.sent", sentResult],
    ["inbox.replies", replyResult],
    ["inbox.organisations", orgResult],
  ] as const) {
    if (result.error) {
      await reportError(result.error, { operation: source });
    }
  }

  const organisations = (orgResult.data ?? []) as OrganisationRow[];
  const orgNames = new Map(organisations.map((row) => [row.id, row.legal_name]));
  const ownerIds = new Map(organisations.map((row) => [row.id, row.owner_id]));

  const threads = buildInboxThreads(
    (sentResult.data ?? []) as InboxMessageRow[],
    (replyResult.data ?? []) as unknown as InboxReplyRow[],
    orgNames,
  );
  const followUps = await fetchFollowUps(supabase, actor.id, organisations);

  const liveRows = buildInboxQueue(threads, ownerIds, followUps, actor.id);

  // TEMPORARY — see the import above. Mock threads fill out the page while the
  // design is settled; a real thread always wins on a clashing organisation id.
  const liveIds = new Set(liveRows.map((row) => row.orgId));
  const rows: InboxQueueRow[] = sortQueueRows([
    ...liveRows,
    ...mockQueueRows(actor.id).filter((row) => !liveIds.has(row.orgId)),
  ]);

  const scopeCounts = countByScope(rows);
  const scoped = filterByScope(rows, scope);
  const bucketCounts = countByBucket(scoped);
  const visible = filterByBucket(scoped, bucket);

  // One list when a bucket is chosen, otherwise a section per bucket so the
  // page reads as a set of piles rather than one undifferentiated column.
  const groups = bucket
    ? [{ bucket, rows: visible }]
    : INBOX_BUCKETS.map((key) => ({
        bucket: key,
        rows: visible.filter((row) => row.bucket === key),
      })).filter((group) => group.rows.length > 0);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-6">
        <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
              Inbox
            </h1>
            <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.55] text-dim">
              Outreach that is waiting on somebody. Replies first, then clients
              that have gone quiet past your follow-up threshold.
            </p>
          </div>
        </Rise>

        <Rise>
          <InboxScopeTabs
            scope={scope}
            bucket={bucket}
            scopeCounts={scopeCounts}
            bucketCounts={bucketCounts}
          />
        </Rise>

        {groups.length === 0 ? (
          <Rise>
            <QueueList
              rows={[]}
              emptyTitle="Nothing waiting"
              emptyHint={
                scope === "mine"
                  ? "No outreach of yours needs an answer or a follow-up. Try the Team or All scope to see the rest of the pipeline."
                  : "No threads match this view."
              }
            />
          </Rise>
        ) : (
          groups.map((group) => (
            <Group key={group.bucket} className="space-y-3">
              <Rise className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                  {bucketLabel(group.bucket)}
                </h2>
                <p className="max-w-[54ch] text-[13px] leading-[1.55] text-dim">
                  {BUCKET_HINT[group.bucket]}
                </p>
              </Rise>
              <QueueList rows={group.rows} />
            </Group>
          ))
        )}
      </Stage>
    </div>
  );
}
