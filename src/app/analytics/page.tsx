import { redirect } from "next/navigation";

import { getCurrentActor } from "@/lib/auth/actor";
import { hasPermission } from "@/lib/auth/permissions";
import { logSecurityEvent } from "@/lib/log-security-event";
import { createClient } from "@/lib/supabase/server";
import { fetchPaged, fetchPagedForOrgs } from "@/lib/supabase/fetch-paged";
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
import {
  describeToneRow,
  tonePerformanceSummary,
  type ToneBreakdownRow,
  type ToneStatusRow,
} from "@/lib/tone-performance";

/**
 * F209 — a sent message with its generation rows, as PostgREST returns the
 * embed. A regeneration stacks one ai_generations row per attempt (F111), so
 * the breakdown reads the LATEST generation per message — the tone of the
 * text that was actually reviewed and sent.
 */
type ToneMessageRow = {
  id: string;
  organisation_id: string;
  ai_generations: {
    id: string;
    tone_register: string | null;
    tone_length: string | null;
    created_at: string;
  }[];
};

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
  let myReplies: CamReplyRow[] = [];
  let toneMessages: ToneMessageRow[] = [];
  let loadFailed = false;

  if (canViewClients) {
    // The `.eq("owner_id", …)` below is a payload optimisation, NOT the security
    // boundary: RLS on organisations is shared-read for every active user, so it
    // is myClients() in JS that actually guarantees F206 AC2. Both are kept.
    const organisations = await fetchPaged<DashboardOrgRow>((from, to) =>
      supabase
        .from("organisations")
        .select("id, legal_name, outreach_status, owner_id, updated_at, created_at")
        .eq("owner_id", actor.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .overrideTypes<DashboardOrgRow[], { merge: false }>(),
    );

    if (organisations.error || !organisations.data) {
      loadFailed = true;
      await reportError(organisations.error ?? new Error("No organisations returned"), {
        operation: "analytics.organisations",
      });
    }

    // Everything else is scoped to the ids this CAM owns. Suppressions,
    // outreach_messages and reply_events are all shared-read under RLS, so
    // reading them whole and discarding the rest in JS returns the same numbers
    // — but the transfer would then grow with the rest of the team's activity
    // rather than with this CAM's, and these are the three fastest-growing
    // tables in the schema. Costs one extra round-trip, because the ids are not
    // known until the query above returns; a CAM who owns nothing runs none of
    // the three at all.
    const candidateIds = (organisations.data ?? []).map((row) => row.id);

    const [openSuppressions, messages, replies, toneMessageResult] = await Promise.all([
      fetchPagedForOrgs<OpenSuppression>(candidateIds, (ids, from, to) =>
        supabase
          .from("suppressions")
          .select("organisation_id, status")
          .in("organisation_id", ids)
          .in("status", ["pending", "active"])
          .order("organisation_id", { ascending: true })
          .range(from, to)
          .overrideTypes<OpenSuppression[], { merge: false }>(),
      ),
      fetchPagedForOrgs<SentMessageRow>(candidateIds, (ids, from, to) =>
        supabase
          .from("outreach_messages")
          .select("id, organisation_id, sent_by_user_id, sent_at")
          .eq("send_status", "sent")
          .in("organisation_id", ids)
          .order("sent_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
          .overrideTypes<SentMessageRow[], { merge: false }>(),
      ),
      fetchPagedForOrgs<CamReplyRow>(candidateIds, (ids, from, to) =>
        supabase
          .from("reply_events")
          .select("id, organisation_id, response_time_seconds, outreach_message_id")
          .in("organisation_id", ids)
          .order("received_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
          .overrideTypes<CamReplyRow[], { merge: false }>(),
      ),
      // F209 — the sent messages whose tone dials are known, read as one embed
      // rather than a second org-scoped sweep of ai_generations: the generation
      // rows travel behind the message they produced, and only the small columns
      // the breakdown needs are selected — never prompt text.
      fetchPagedForOrgs<ToneMessageRow>(candidateIds, (ids, from, to) =>
        supabase
          .from("outreach_messages")
          .select(
            "id, organisation_id, ai_generations(id, tone_register, tone_length, created_at)",
          )
          .eq("send_status", "sent")
          .in("organisation_id", ids)
          .order("sent_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
          .overrideTypes<ToneMessageRow[], { merge: false }>(),
      ),
    ]);

    if (openSuppressions.error || !openSuppressions.data) {
      loadFailed = true;
      await reportError(openSuppressions.error ?? new Error("No suppressions returned"), {
        operation: "analytics.suppressions",
      });
    }
    if (messages.error || !messages.data) {
      loadFailed = true;
      await reportError(messages.error ?? new Error("No sent messages returned"), {
        operation: "analytics.sent_messages",
      });
    }
    if (replies.error || !replies.data) {
      loadFailed = true;
      await reportError(replies.error ?? new Error("No reply events returned"), {
        operation: "analytics.reply_events",
      });
    }
    if (toneMessageResult.error || !toneMessageResult.data) {
      loadFailed = true;
      await reportError(toneMessageResult.error ?? new Error("No tone rows returned"), {
        operation: "analytics.tone_messages",
      });
    } else {
      toneMessages = toneMessageResult.data;
    }

    // Suppression filter first, ownership filter second — the same order
    // /dashboard and /clients use, so the counts on this page agree with theirs.
    ownedRows = myClients(
      filterActiveSuppressed(organisations.data ?? [], openSuppressions.data ?? []),
      actor.id,
    );

    // The three reads above are scoped to `candidateIds`, which is every client
    // this CAM owns *before* the suppression filter — the filter needs the
    // suppression rows, so it cannot run first. A suppressed client's rows are
    // therefore still in hand and have to be dropped here. computeCamOutreach
    // already keys off ownedRows, but typicalResponseTime takes the replies as
    // given, so an actively-suppressed client would otherwise still move the
    // CAM's typical response time.
    const ownedIds = new Set(ownedRows.map((row) => row.id));
    sentMessages = (messages.data ?? []).filter((row) => ownedIds.has(row.organisation_id));
    myReplies = (replies.data ?? []).filter((row) => ownedIds.has(row.organisation_id));
    toneMessages = (toneMessageResult.data ?? []).filter((row) => ownedIds.has(row.organisation_id));
  }

  const replySummary = summariseTrackedReplies(myReplies, ownedRows);
  const totals = computeCamOutreach(ownedRows, sentMessages, replySummary, actor.id);
  const ratio = conversionVsNoResponse(ownedRows);
  const typical = typicalResponseTime(myReplies);
  const slowest = slowestClients(ownedRows, replySummary.responseTimeByClient, typical);

  // F209 — flatten the embed to one tone record per sent message: the latest
  // generation wins (a regeneration's dials describe the text that was sent,
  // earlier attempts do not). Rows feed both dials; the module buckets them
  // independently. Messages with no generation row (blank drafts, pre-F112
  // sends) drop out here and are counted as untracked by the module instead —
  // AC3's exclusion, made visible on the card.
  const toneRows = toneMessages.flatMap((message) => {
    const latest = [...(message.ai_generations ?? [])].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    )[0];
    if (!latest) return [];
    return [
      {
        id: message.id,
        organisation_id: message.organisation_id,
        tone_register: latest.tone_register,
        tone_length: latest.tone_length,
      },
    ];
  });
  // Conversions come from the client's current pipeline status — the same
  // source the cards above read, so the two can never disagree.
  const statusByOrg = new Map(
    ownedRows.map((row) => [row.id, row.outreach_status] as const),
  );
  const toneStatusRows: ToneStatusRow[] = toneRows.flatMap((row) => {
    const outreachStatus = statusByOrg.get(row.organisation_id);
    return outreachStatus
      ? [{ message_id: row.id, organisation_id: row.organisation_id, outreach_status: outreachStatus }]
      : [];
  });
  const toneSummary = tonePerformanceSummary(toneRows, toneRows, myReplies, toneStatusRows);

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
          // Only claim the CAM owns nothing when we actually know that. After a
          // failed load ownedRows is empty for a quite different reason, and
          // "claim a client" would be advice about a problem they do not have.
          <Rise>
            <EmptyState
              message={
                loadFailed
                  ? "Your outreach numbers could not be loaded, so there is nothing to show yet. Refresh to try again."
                  : "You do not own any clients yet. Claim one from the client list and your outreach numbers start filling in here."
              }
            />
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

            {canViewClients && totals.clientsOwned > 0 && (
              <Group className="space-y-4">
                <Rise>
                  <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">
                    What tone works
                  </h2>
                </Rise>
                <Rise>
                  <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                      Reply and conversion rates by email tone (F107)
                    </p>
                    {(toneSummary.untrackedRegister > 0 || toneSummary.untrackedLength > 0) && (
                      <div className="mt-2 space-y-1 text-[11px] text-foreground/40">
                        {toneSummary.untrackedRegister > 0 && (
                          <p>
                            {toneSummary.untrackedRegister.toLocaleString()} sent email
                            {toneSummary.untrackedRegister === 1 ? "" : "s"} predate register tracking or
                            were generated without a register, so they are excluded from the tone table.
                          </p>
                        )}
                        {toneSummary.untrackedLength > 0 && (
                          <p>
                            {toneSummary.untrackedLength.toLocaleString()} sent email
                            {toneSummary.untrackedLength === 1 ? "" : "s"} predate length tracking or
                            were generated without a length, so they are excluded from the length table.
                          </p>
                        )}
                      </div>
                    )}
                    <ToneTable
                      title="Tone"
                      caption="How the email reads"
                      rows={toneSummary.register}
                    />
                    <ToneTable
                      title="Length"
                      caption="How much of it there is"
                      rows={toneSummary.length}
                      className="mt-6"
                    />
                  </div>
                </Rise>
              </Group>
            )}
          </>
        )}
      </Stage>
    </div>
  );
}

/**
 * F209 — one dial's breakdown as a small table. Kept server-rendered and
 * dumb: every interesting decision (exclusions, thresholds, rates) was made
 * in tone-performance.ts and is testable there. Rows always render in enum
 * order — a tone nobody has used yet shows as a row saying so, because a
 * missing row would read as "this tone was removed".
 */
function ToneTable({
  title,
  caption,
  rows,
  className,
}: {
  title: string;
  caption: string;
  rows: ToneBreakdownRow[];
  className?: string;
}) {
  const pct = (rate: number | null) =>
    rate === null ? "—" : `${Math.round(rate * 100)}%`;

  return (
    <div className={className}>
      <p className="mt-4 text-xs font-semibold text-foreground/75">
        {title} <span className="font-normal text-foreground/40">· {caption}</span>
      </p>
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-black/[0.06]">
            <th scope="col" className="py-2 pr-3 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Setting
            </th>
            <th scope="col" className="py-2 pr-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Sent
            </th>
            <th scope="col" className="py-2 pr-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Reply rate
            </th>
            <th scope="col" className="py-2 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Converted
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.value} className="border-b border-black/[0.04] last:border-0">
              <td className="py-2 pr-3 font-medium">{row.label}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{row.sent.toLocaleString()}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{pct(row.responseRate)}</td>
              <td className="py-2 text-right tabular-nums">{pct(row.conversionRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-2 space-y-1">
        {rows
          .filter((row) => row.sent > 0 && !row.hasEnoughData)
          .map((row) => (
            <li key={row.value} className="text-[11px] text-foreground/40">
              {row.label}: {describeToneRow(row)}
            </li>
          ))}
      </ul>
    </div>
  );
}
