import { redirect } from "next/navigation";

import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/stat-card";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import {
  filterActiveSuppressed,
  type DashboardOrgRow,
  type OpenSuppression,
} from "@/lib/dashboard-metrics";
import { formatResponseTime, summariseTrackedReplies } from "@/lib/reply-analytics";
import {
  computeCamOutreach,
  conversionVsNoResponse,
  describeConversionRatio,
  describeTypicalResponseTime,
  formatConversionRatio,
  formatRate,
  myClients,
  slowestClients,
  typicalResponseTime,
  type CamReplyRow,
  type SentMessageRow,
} from "@/lib/cam-analytics";

/**
 * F206/F207/F208 — the CAM's own outreach performance, as opposed to the
 * platform-wide readings on /dashboard.
 *
 * Every figure here describes *clients you own*. The eyebrow says so on screen,
 * because a personal analytics page that quietly showed team totals would be
 * worse than no page at all (F206 AC2).
 *
 * The root element is a `div`, not a `main`: AppShell already renders the
 * `main` this is slotted into.
 */

const FETCH_STEP = 1000;

export default async function AnalyticsPage() {
  // One client for the whole request. It was created twice before — once to
  // read the user and again to run the queries — which is two cookie parses and
  // two client objects for no gain.
  const supabase = await createClient();

  let user;

  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    redirect("/login");
  }

  if (!user) {
    redirect("/login");
  }

  const actorResult = await getCurrentActor();
  if (!actorResult.ok) {
    logSecurityEvent("permission.denied", {
      route: "/analytics",
      reason: actorResult.reason,
    });
    redirect("/login");
  }
  const actor = actorResult.actor;

  const canViewClients = hasPermission(actor.role, "client:view");

  let ownedRows: DashboardOrgRow[] = [];
  let sentMessages: SentMessageRow[] = [];
  let trackedReplies: CamReplyRow[] = [];
  let loadFailed = false;

  if (canViewClients) {
    // PostgREST caps a single response at 1000 rows, so a plain `.select()`
    // silently truncates once a table grows past that — /dashboard records the
    // 1794-row staging dataset that first hit this. Walk the range instead.
    async function fetchPaged<T>(
      build: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    ): Promise<{ data: T[] | null; error: { message: string } | null }> {
      const all: T[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await build(from);
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < FETCH_STEP) break;
        from += FETCH_STEP;
      }
      return { data: all, error: null };
    }

    /**
     * `.in()` travels in the query string, and a CAM with hundreds of clients
     * would build a URL long enough for PostgREST to reject. Ask in batches and
     * concatenate: still far less data than reading the whole table.
     */
    const ID_BATCH = 200;
    async function fetchByOrganisation<T>(
      ids: readonly string[],
      build: (
        batch: readonly string[],
        from: number,
      ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    ): Promise<{ data: T[] | null; error: { message: string } | null }> {
      const all: T[] = [];
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const batch = ids.slice(i, i + ID_BATCH);
        const { data, error } = await fetchPaged<T>((from) => build(batch, from));
        if (error || !data) return { data: null, error };
        all.push(...data);
      }
      return { data: all, error: null };
    }

    // The `.eq("owner_id", …)` here is a payload optimisation, NOT the security
    // boundary: RLS on organisations is shared-read for every active user, so it
    // is myClients() in JS that actually guarantees F206 AC2. Both are kept.
    const organisations = await fetchPaged<DashboardOrgRow>((from) =>
      supabase
        .from("organisations")
        .select("id, legal_name, outreach_status, owner_id, updated_at, created_at")
        .eq("owner_id", actor.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + FETCH_STEP - 1)
        .overrideTypes<DashboardOrgRow[], { merge: false }>(),
    );

    if (organisations.error || !organisations.data) {
      loadFailed = true;
      await reportError(organisations.error ?? new Error("No organisations returned"), {
        operation: "analytics.organisations",
      });
    }

    // Everything below is scoped to the ids this CAM actually owns. Reading
    // suppressions, outreach_messages and reply_events whole and discarding the
    // rest in JS meant three full table walks per page load, and they are the
    // three tables that grow fastest. Costs one extra round-trip: the ids are
    // not known until the organisations come back. A CAM who owns nothing runs
    // none of these at all.
    const ownedIds = (organisations.data ?? []).map((row) => row.id);

    if (ownedIds.length > 0) {
      const [openSuppressions, messages, replies] = await Promise.all([
        fetchByOrganisation<OpenSuppression>(ownedIds, (batch, from) =>
          supabase
            .from("suppressions")
            .select("organisation_id, status")
            .in("organisation_id", batch)
            .in("status", ["pending", "active"])
            .order("organisation_id", { ascending: true })
            .range(from, from + FETCH_STEP - 1)
            .overrideTypes<OpenSuppression[], { merge: false }>(),
        ),
        fetchByOrganisation<SentMessageRow>(ownedIds, (batch, from) =>
          supabase
            .from("outreach_messages")
            .select("id, organisation_id, sent_by_user_id, sent_at")
            .in("organisation_id", batch)
            .eq("send_status", "sent")
            .order("sent_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + FETCH_STEP - 1)
            .overrideTypes<SentMessageRow[], { merge: false }>(),
        ),
        fetchByOrganisation<CamReplyRow>(ownedIds, (batch, from) =>
          supabase
            .from("reply_events")
            .select("id, organisation_id, response_time_seconds")
            .in("organisation_id", batch)
            .order("received_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + FETCH_STEP - 1)
            .overrideTypes<CamReplyRow[], { merge: false }>(),
        ),
      ]);

      for (const [operation, source] of [
        ["analytics.suppressions", openSuppressions],
        ["analytics.sent_messages", messages],
        ["analytics.reply_events", replies],
      ] as const) {
        if (source.error || !source.data) {
          loadFailed = true;
          await reportError(source.error ?? new Error(`No rows returned for ${operation}`), {
            operation,
          });
        }
      }

      // Suppression filter first, ownership filter second — the same order
      // /dashboard and /clients use, so the counts on this page agree with theirs.
      ownedRows = myClients(
        filterActiveSuppressed(organisations.data ?? [], openSuppressions.data ?? []),
        actor.id,
      );
      sentMessages = messages.data ?? [];
      trackedReplies = replies.data ?? [];
    }
  }

  const myReplies = (() => {
    const mineIds = new Set(ownedRows.map((row) => row.id));
    return trackedReplies.filter((row) => mineIds.has(row.organisation_id));
  })();

  const replySummary = summariseTrackedReplies(myReplies, ownedRows);
  const totals = computeCamOutreach(ownedRows, sentMessages, replySummary, actor.id);
  const ratio = conversionVsNoResponse(ownedRows);
  const typical = typicalResponseTime(myReplies);
  const slowest = slowestClients(ownedRows, replySummary.responseTimeByClient, typical);

  const share = (value: number) =>
    totals.contacted === 0 ? 0 : Math.min(value / totals.contacted, 1);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-10">
        <Rise>
          <header>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Clients you own · you only
            </p>
            <h1 className="mt-2 font-body text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1] tracking-[-0.03em]">
              Your analytics
            </h1>
          </header>
        </Rise>

        {loadFailed && (
          <Rise>
            <InlineAlert
              variant="page"
              message="Some of your analytics could not be loaded. This has been recorded — refresh and try again."
            />
          </Rise>
        )}

        {!canViewClients ? (
          <Rise>
            <EmptyState message="Your account does not have access to client data, so there is no outreach to report on." />
          </Rise>
        ) : totals.clientsOwned === 0 ? (
          <Rise>
            <EmptyState message="You do not own any clients yet. Claim one from the client list and your outreach numbers start filling in here." />
          </Rise>
        ) : (
          <>
            <Group className="space-y-4">
              <Rise>
                <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">
                  Your outreach
                </h2>
              </Rise>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Rise>
                  <StatCard
                    label="Emails sent"
                    value={totals.emailsSent}
                    share={share(totals.emailsSent)}
                    caption={
                      totals.emailsSentBeforeHandover > 0
                        ? `${totals.emailsSentByMe.toLocaleString()} you sent · ${totals.emailsSentBeforeHandover.toLocaleString()} sent before handover`
                        : `All sent by you · to ${totals.contacted.toLocaleString()} contacted clients`
                    }
                  />
                </Rise>
                <Rise>
                  <StatCard
                    label="Replies received"
                    value={totals.respondingClients}
                    share={share(totals.respondingClients)}
                    caption={`${formatRate(totals.replyRate)} · ${totals.repliesReceived.toLocaleString()} replies in total`}
                  />
                </Rise>
                <Rise>
                  <StatCard
                    label="Conversions"
                    value={totals.conversions}
                    share={share(totals.conversions)}
                    caption={formatRate(totals.conversionRate)}
                    emphasis
                  />
                </Rise>
              </div>
            </Group>

            <Group className="space-y-4">
              <Rise>
                <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">
                  Converted against no response
                </h2>
              </Rise>
              <Rise>
                <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                    Conversions per one unanswered
                  </p>
                  <p className="mt-3 text-[2.25rem] font-black leading-none tracking-[-0.03em] tabular-nums">
                    {ratio.hasEnoughData ? formatConversionRatio(ratio) : "—"}
                  </p>
                  <dl className="mt-5 flex gap-8">
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                        Converted
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {ratio.converted.toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                        No response
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {ratio.noResponse.toLocaleString()}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-[11px] text-foreground/40">
                    {describeConversionRatio(ratio)}
                  </p>
                  {!ratio.hasEnoughData && ratio.total > 0 && (
                    <InlineAlert
                      className="mt-4"
                      tone="warning"
                      message={`A ratio from ${ratio.total} outcome${ratio.total === 1 ? "" : "s"} would read as a trend when it is not one. It appears once you have ${ratio.threshold}.`}
                    />
                  )}
                </div>
              </Rise>
            </Group>

            <Group className="space-y-4">
              <Rise>
                <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">
                  Typical response time
                </h2>
              </Rise>
              {!typical.hasEnoughData ? (
                <Rise>
                  <EmptyState message={describeTypicalResponseTime(typical)} />
                </Rise>
              ) : (
                <Rise>
                  <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                      How long your clients take to reply
                    </p>
                    <p className="mt-3 text-[2.25rem] font-black leading-none tracking-[-0.03em] tabular-nums">
                      {formatResponseTime(typical.meanSeconds)}
                    </p>
                    <dl className="mt-5 flex flex-wrap gap-8">
                      <div>
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                          Fastest
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums">
                          {formatResponseTime(typical.fastestSeconds)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                          Typical
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums">
                          {formatResponseTime(typical.meanSeconds)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                          Slowest
                        </dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums">
                          {formatResponseTime(typical.slowestSeconds)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-4 text-[11px] text-foreground/40">
                      {describeTypicalResponseTime(typical)} Only the first reply to each email
                      is timed, so this counts fewer replies than you have received.
                    </p>

                    {slowest.length > 0 && (
                      <div className="mt-6 border-t border-black/[0.06] pt-4">
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                          Slowest to come back
                        </p>
                        <ul className="mt-3 space-y-2">
                          {slowest.map((client) => (
                            <li
                              key={client.id}
                              className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                            >
                              <span className="font-medium">{client.legalName}</span>
                              <span className="text-[11px] text-foreground/40">{client.label}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Rise>
              )}
            </Group>
          </>
        )}
      </Stage>
    </div>
  );
}
