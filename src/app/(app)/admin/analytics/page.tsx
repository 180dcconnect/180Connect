import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { fetchPaged } from "@/lib/supabase/fetch-paged";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/stat-card";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import { AnalyticsHeader } from "../analytics-header";
import {
  filterActiveSuppressed,
  type DashboardOrgRow,
  type OpenSuppression,
} from "@/lib/dashboard-metrics";
import { formatResponseTime } from "@/lib/reply-analytics";
import { formatRate, type CamReplyRow, type SentMessageRow } from "@/lib/cam-analytics";
import { formatWinRate } from "@/lib/outreach-rates";
import {
  conversionsOverTime,
  cycleTeamTotals,
  describeUncountedClients,
  perCamAnalytics,
  sortByNeed,
  teamTotals,
  uncountedClients,
  type CycleTeamTotals,
  type OutcomeRow,
} from "@/lib/admin/manager-analytics";
import {
  cycleWindow,
  describeCycleWindow,
  filterByWindow,
  orderCyclesByStart,
  previousCycle,
  type OutreachCycle,
} from "@/lib/outreach-cycles";
import {
  ownerLoad,
  pipelineCounts,
  sectorCounts,
  type DashboardClient,
} from "@/lib/admin/dashboard-metrics";
import { formatOutreachStatus } from "@/lib/organisation-format";
import { priorityScoreOutOf100 } from "@/lib/priority-opportunities";

/**
 * F210/F212 — the team-wide read of the analytics each CAM sees for themselves
 * on /analytics. One tab of the Analytics group — see
 * `src/app/(app)/admin/analytics-group.ts`.
 *
 * Every panel is fed by its own independently-caught query, so a source that
 * fails or has no rows yet shows its own empty state instead of blanking the
 * page — F212 AC3 asks for exactly that, since several of its stated
 * dependencies may never be finished.
 */

type CamRow = { id: string; full_name: string | null; role: string };

/** The organisations read, plus what the pipeline, ownership and sector panels need. */
type AnalyticsOrgRow = DashboardOrgRow & {
  sector: string | null;
  city: string | null;
  owner: { full_name: string | null } | null;
};

type ScoreRow = {
  organisation_id: string;
  priority_score: number | null;
  priority_band: "high" | "medium" | "low" | null;
};

/** How many sectors the sector table lists before summarising the rest. */
const SECTOR_ROWS = 12;

/** Replies with the arrival timestamp cycle filtering needs. */
type DatedReplyRow = CamReplyRow & { received_at: string | null };

/**
 * One cycle's three flow tiles. Rates reuse the all-time tiles' own
 * formatters, so a cycle's 40% means the same thing as all-time's 40% —
 * `cycleTeamTotals` guarantees the definitions match.
 */
function CycleTiles({
  name,
  windowLabel,
  totals,
}: {
  name: string;
  windowLabel: string;
  totals: CycleTeamTotals;
}) {
  const share = (value: number) =>
    totals.contactedClients === 0 ? 0 : Math.min(value / totals.contactedClients, 1);
  return (
    <div>
      <p className="font-body text-sm font-bold text-ink">
        {name} <span className="font-normal tabular-nums text-dim">· {windowLabel}</span>
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Rise>
          <StatCard
            label="Emails sent"
            value={totals.emailsSent}
            share={share(totals.emailsSent)}
            caption={`${totals.contactedClients.toLocaleString()} clients contacted`}
          />
        </Rise>
        <Rise>
          <StatCard
            label="Replies received"
            value={totals.respondingClients}
            share={share(totals.respondingClients)}
            caption={formatRate(totals.replyRate)}
          />
        </Rise>
        <Rise>
          <StatCard
            label="Conversions"
            value={totals.conversions}
            share={share(totals.conversions)}
            caption={formatWinRate(totals.winRate)}
            emphasis
          />
        </Rise>
      </div>
    </div>
  );
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ cycleA?: string | string[]; cycleB?: string | string[] }>;
}) {
  const authorization = await getViewingActor("user:manage", {
    route: "/admin/analytics",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const query = await searchParams;
  const firstParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const supabase = await createClient();

  const [organisations, openSuppressions, messages, replies, outcomes, cams, scores, cyclesResult] = await Promise.all([
    fetchPaged<AnalyticsOrgRow>(
      (from, to) =>
        supabase
          .from("organisations")
          .select(
            "id, legal_name, outreach_status, owner_id, updated_at, created_at, sector, city, owner:users!organisations_owner_id_fkey(full_name)",
          )
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
          .overrideTypes<AnalyticsOrgRow[], { merge: false }>(),
      { pagesPerRound: 4 },
    ),
    fetchPaged<OpenSuppression>((from, to) =>
      supabase
        .from("suppressions")
        .select("organisation_id, status")
        .in("status", ["pending", "active"])
        .order("organisation_id", { ascending: true })
        .range(from, to)
        .overrideTypes<OpenSuppression[], { merge: false }>(),
    ),
    fetchPaged<SentMessageRow>((from, to) =>
      supabase
        .from("outreach_messages")
        .select("id, organisation_id, sent_by_user_id, sent_at")
        .eq("send_status", "sent")
        .order("sent_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .overrideTypes<SentMessageRow[], { merge: false }>(),
    ),
    fetchPaged<CamReplyRow>((from, to) =>
      supabase
        .from("reply_events")
        .select("id, organisation_id, response_time_seconds, received_at")
        .order("received_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .overrideTypes<DatedReplyRow[], { merge: false }>(),
    ),
    fetchPaged<OutcomeRow>((from, to) =>
      supabase
        .from("outcomes")
        .select("id, organisation_id, outcome_type, created_at")
        .eq("outcome_type", "converted")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .overrideTypes<OutcomeRow[], { merge: false }>(),
    ),
    // Admins are included alongside CAMs because an admin can own clients too,
    // and a row of outreach that belongs to nobody in the table would make the
    // team totals disagree with the rows they are summed from. The table is
    // labelled "team member" rather than "CAM" for the same reason.
    fetchPaged<CamRow>((from, to) =>
      supabase
        .from("users")
        .select("id, full_name, role")
        .in("role", ["cam", "admin"])
        .eq("is_active", true)
        .order("full_name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .overrideTypes<CamRow[], { merge: false }>(),
    ),
    // For the sector table's average priority score.
    fetchPaged<ScoreRow>(
      (from, to) =>
        supabase
          .from("latest_scores")
          .select("organisation_id, priority_score, priority_band")
          .order("organisation_id", { ascending: true })
          .range(from, to)
          .overrideTypes<ScoreRow[], { merge: false }>(),
      { pagesPerRound: 4 },
    ),
    // Outreach cycle definitions for the compare picker — a handful of rows,
    // so a plain select rather than fetchPaged. A failed read degrades to no
    // picker (the all-time view), never to a failed page.
    supabase
      .from("outreach_cycles")
      .select("id, name, starts_on, ends_on")
      .order("starts_on", { ascending: true }),
  ]);

  const sources = {
    "admin.analytics.organisations": organisations,
    "admin.analytics.suppressions": openSuppressions,
    "admin.analytics.sent_messages": messages,
    "admin.analytics.reply_events": replies,
    "admin.analytics.outcomes": outcomes,
    "admin.analytics.users": cams,
    "admin.analytics.scores": scores,
  };
  let loadFailed = false;
  for (const [operation, source] of Object.entries(sources)) {
    if (source.error || !source.data) {
      loadFailed = true;
      await reportError(source.error ?? new Error(`No rows returned for ${operation}`), {
        operation,
      });
    }
  }
  if (cyclesResult.error) {
    await reportError(cyclesResult.error, { operation: "admin.analytics.cycles" });
  }

  // ── Cycle comparison ──
  //
  // ?cycleA=<id>&cycleB=<id> scopes the flow tiles and the conversions chart
  // to those windows. Membership is derived from event dates at read time, so
  // defining a cycle tomorrow sorts all of history with no backfill. An
  // unknown id degrades to unset with a note, never to a failed page.
  const cycleList: OutreachCycle[] = orderCyclesByStart(
    (cyclesResult.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      starts_on: row.starts_on as string,
      ends_on: row.ends_on as string,
    })),
  );
  const cycleA = cycleList.find((cycle) => cycle.id === firstParam(query.cycleA)) ?? null;
  const cycleBParam = firstParam(query.cycleB);
  const cycleB =
    cycleBParam !== undefined
      ? (cycleList.find((cycle) => cycle.id === cycleBParam) ?? null)
      : cycleA
        ? previousCycle(cycleList, cycleA)
        : null;
  const unknownCycle =
    (firstParam(query.cycleA) !== undefined && !cycleA) ||
    (cycleBParam !== undefined && cycleBParam !== "" && !cycleB);

  const scopedTotals = (cycle: OutreachCycle | null) => {
    if (!cycle) return null;
    const window = cycleWindow(cycle);
    const windowMessages = filterByWindow(messages.data ?? [], (row) => row.sent_at, window);
    const windowReplies = filterByWindow(
      (replies.data ?? []) as DatedReplyRow[],
      (row) => row.received_at,
      window,
    );
    const windowOutcomes = filterByWindow(outcomes.data ?? [], (row) => row.created_at, window);
    return {
      cycle,
      window,
      totals: cycleTeamTotals({
        messages: windowMessages,
        replies: windowReplies,
        conversions: windowOutcomes,
      }),
      outcomes: windowOutcomes,
    };
  };
  const compareA = scopedTotals(cycleA);
  const compareB = scopedTotals(cycleB);

  const rows = filterActiveSuppressed(organisations.data ?? [], openSuppressions.data ?? []);
  const camList = (cams.data ?? []).map((cam) => ({
    id: cam.id,
    name: cam.full_name ?? "Unnamed user",
  }));

  const perCam = sortByNeed(
    perCamAnalytics(rows, messages.data ?? [], replies.data ?? [], camList),
  );
  const totals = teamTotals(perCam);
  // Clients no row in the table accounts for — a deactivated owner's, or none
  // at all. Stated on the page rather than dropped: teamTotals sums the per-CAM
  // rows, so without this they left every figure with nothing to show they had
  // ever existed.
  const uncountedMessage = describeUncountedClients(uncountedClients(rows, camList));
  // In compare mode the chart covers the A cycle's own span, anchored at its
  // last day — the same function, just pointed at the cycle instead of the
  // trailing window. Ownership, pipeline and sectors below stay as-of-today:
  // they describe the list now, not the cycle, and the tiles say so.
  const chartCycleDays = compareA
    ? Math.max(
        1,
        Math.round((compareA.window.endMs - compareA.window.startMs) / (24 * 60 * 60 * 1000)),
      )
    : 90;
  const conversionSeries = compareA
    ? conversionsOverTime(
        compareA.outcomes,
        chartCycleDays,
        new Date(`${compareA.cycle.ends_on}T12:00:00Z`),
      )
    : conversionsOverTime(outcomes.data ?? [], 90);

  // Pipeline stages, ownership and sectors — moved here from the retired admin
  // dashboard. Same visible set as the team figures above: actively suppressed
  // clients are out of every count.
  const visibleIds = new Set(rows.map((row) => row.id));
  const scoreByOrg = new Map((scores.data ?? []).map((row) => [row.organisation_id, row]));
  const clients: DashboardClient[] = (organisations.data ?? [])
    .filter((row) => visibleIds.has(row.id))
    .map((row) => ({
      id: row.id,
      legal_name: row.legal_name,
      outreach_status: row.outreach_status,
      owner_id: row.owner_id,
      owner_name: row.owner?.full_name ?? null,
      sector: row.sector,
      city: row.city,
      created_at: row.created_at,
      updated_at: row.updated_at,
      priority_score: scoreByOrg.get(row.id)?.priority_score ?? null,
      priority_band: scoreByOrg.get(row.id)?.priority_band ?? null,
    }));
  const stages = pipelineCounts(clients);
  const loads = ownerLoad(clients);
  const sectors = sectorCounts(clients);

  const share = (value: number) =>
    totals.contacted === 0 ? 0 : Math.min(value / totals.contacted, 1);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-10">
        <Rise>
          <AnalyticsHeader current="/admin/analytics">
            <p className="mt-3 text-sm leading-[1.7] text-dim">
              Every team member&rsquo;s outreach performance, in one place — including
              who may need support. Only admins can see this.
            </p>
          </AnalyticsHeader>
        </Rise>

        {loadFailed && (
          <Rise>
            <InlineAlert
              variant="page"
              message="Some team analytics could not be loaded. This has been recorded — refresh and try again."
            />
          </Rise>
        )}

        <Group className="space-y-4">
          <Rise>
            <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">
              {compareA
                ? compareB
                  ? `${compareA.cycle.name} vs ${compareB.cycle.name}`
                  : compareA.cycle.name
                : "Across the team"}
            </h2>
            {compareA && (
              <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
                Emails count in the cycle they left in; replies and conversions
                in the cycle they arrived in.                 Clients, pipeline and sectors
                below describe the list as it stands today.
              </p>
            )}
          </Rise>
          {uncountedMessage && (
            <Rise>
              <InlineAlert variant="page" tone="warning" message={uncountedMessage} />
            </Rise>
          )}
          <Rise>
            {cycleList.length === 0 ? (
              <p className="text-sm leading-[1.7] text-dim">
                No cycles defined yet —{" "}
                <Link href="/settings/cycles" className="font-bold text-lead hover:underline">
                  define them in Settings
                </Link>{" "}
                to compare them here.
              </p>
            ) : (
              <form
                method="get"
                action="/admin/analytics"
                className="flex flex-wrap items-end gap-x-3 gap-y-3"
              >
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-xs font-semibold text-foreground/60"
                    htmlFor="cycle-a"
                  >
                    Cycle
                  </label>
                  <select
                    id="cycle-a"
                    name="cycleA"
                    defaultValue={compareA?.cycle.id ?? ""}
                    className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="">All time</option>
                    {cycleList.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </option>
                    ))}
                  </select>
                </div>
                <span aria-hidden="true" className="pb-2 text-sm font-bold text-foreground/40">
                  vs
                </span>
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-xs font-semibold text-foreground/60"
                    htmlFor="cycle-b"
                  >
                    Compare with
                  </label>
                  <select
                    id="cycle-b"
                    name="cycleB"
                    defaultValue={compareB?.cycle.id ?? ""}
                    className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="">None</option>
                    {cycleList
                      .filter((cycle) => cycle.id !== compareA?.cycle.id)
                      .map((cycle) => (
                        <option key={cycle.id} value={cycle.id}>
                          {cycle.name}
                        </option>
                      ))}
                  </select>
                </div>
                {/* `--ink`, the app's button colour (`docs/app-design-system.md`
                    §Colour: "Buttons are --ink"). This read `bg-[#102a4e]`, a
                    navy that existed on this button and nowhere else in the
                    app — the page-local hex the design system forbids. */}
                <button
                  type="submit"
                  className="rounded-inset bg-ink px-4 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                >
                  Compare
                </button>
                {(firstParam(query.cycleA) !== undefined ||
                  firstParam(query.cycleB) !== undefined) && (
                  <Link
                    href="/admin/analytics"
                    className="pb-1.5 text-xs font-bold text-foreground/55 hover:text-foreground"
                  >
                    Clear
                  </Link>
                )}
              </form>
            )}
          </Rise>
          {unknownCycle && (
            <Rise>
              <InlineAlert
                variant="page"
                tone="warning"
                message="A chosen cycle no longer exists — showing what remains."
              />
            </Rise>
          )}
          {compareA ? (
            <>
              <CycleTiles
                name={compareA.cycle.name}
                windowLabel={describeCycleWindow(compareA.cycle)}
                totals={compareA.totals}
              />
              {compareB ? (
                <CycleTiles
                  name={compareB.cycle.name}
                  windowLabel={describeCycleWindow(compareB.cycle)}
                  totals={compareB.totals}
                />
              ) : (
                <Rise>
                  <p className="text-sm leading-[1.7] text-dim">
                    No earlier cycle to compare against —{" "}
                    <Link
                      href="/settings/cycles"
                      className="font-bold text-lead hover:underline"
                    >
                      define one in Settings
                    </Link>{" "}
                    and pick it above.
                  </p>
                </Rise>
              )}
            </>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Rise>
              <StatCard
                label="Clients owned"
                value={totals.clientsOwned}
                share={totals.clientsOwned === 0 ? 0 : totals.contacted / totals.clientsOwned}
                caption={`${totals.contacted.toLocaleString()} contacted · ${totals.cams} team member${totals.cams === 1 ? "" : "s"}`}
              />
            </Rise>
            <Rise>
              <StatCard
                label="Emails sent"
                value={totals.emailsSent}
                share={share(totals.emailsSent)}
                caption="Across every owned client"
              />
            </Rise>
            <Rise>
              <StatCard
                label="Replies received"
                value={totals.respondingClients}
                share={share(totals.respondingClients)}
                caption={formatRate(totals.replyRate)}
              />
            </Rise>
            <Rise>
              <StatCard
                label="Conversions"
                value={totals.conversions}
                share={share(totals.conversions)}
                caption={formatWinRate(totals.winRate)}
                emphasis
              />
            </Rise>
          </div>
          )}
        </Group>

        <Group className="space-y-4">
          <Rise>
            <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">
              Conversions over time
            </h2>
          </Rise>
          <Rise>
            {conversionSeries.some((point) => point.value > 0) ? (
              <>
                {/*
                  `total` is deliberately NOT passed. ProgressMetricCard treats an
                  explicit total as final (`total ?? fmtCompact(stats.sum)`), so
                  passing the all-time figure would pin the headline while the
                  period selector moved the chart underneath it — picking "Past 7
                  days" would show a week of bars above a number counting every
                  conversion ever. Omitted, it sums the selected window, and the
                  headline and the chart always describe the same period.
                */}
                <ProgressMetricCard
                  size="lg"
                  title="Conversions"
                  unit="conversions"
                  accent="brand"
                  data={conversionSeries}
                  period={compareA ? compareA.cycle.name : "Past 30 days"}
                  periodOptions={
                    compareA
                      ? [{ label: compareA.cycle.name, points: chartCycleDays }]
                      : [
                          { label: "Past 7 days", points: 7 },
                          { label: "Past 30 days", points: 30 },
                          { label: "Past quarter", points: 90 },
                        ]
                  }
                  allowCustomRange={!compareA}
                  showFooter={false}
                  className="rounded-2xl border-black/[0.06] shadow-sm"
                />
                <p className="mt-3 text-[11px] text-foreground/40">
                  Dated by when the conversion was recorded. Clients that had already
                  converted when tracking was switched on all carry that day&rsquo;s date, so a
                  single tall bar early in the series is the backfill rather than a real
                  surge.{" "}
                  {compareA
                    ? `${compareA.cycle.name} conversions: ${compareA.totals.conversions.toLocaleString()}.`
                    : `All-time conversions: ${totals.conversions.toLocaleString()}.`}
                </p>
              </>
            ) : (
              <EmptyState
                message={
                  compareA
                    ? `No conversions recorded in ${compareA.cycle.name}. This chart fills in as clients convert.`
                    : "No conversions recorded in the last quarter. This chart fills in as clients convert."
                }
              />
            )}
          </Rise>
        </Group>

        <Group className="space-y-4">
            <Rise>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">By team member</h2>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  {totals.camsNeedingSupport > 0
                    ? `${totals.camsNeedingSupport} may need support`
                    : "Nobody flagged"}
                </p>
              </div>
              {compareA && (
                <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
                  All-time figures per person — the cycle comparison applies to the
                  tiles and chart above.
                </p>
              )}
            </Rise>
          <Rise>
            {perCam.length === 0 ? (
              <EmptyState message="No active team members yet. Invite one from the team page and their numbers appear here." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.06] text-left text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                      <th scope="col" className="px-5 py-3 font-bold">Team member</th>
                      <th scope="col" className="px-5 py-3 font-bold">Clients</th>
                      <th scope="col" className="px-5 py-3 font-bold">Contacted</th>
                      <th scope="col" className="px-5 py-3 font-bold">Replies / rate</th>
                      <th scope="col" className="px-5 py-3 font-bold">Won / win rate</th>
                      <th scope="col" className="px-5 py-3 font-bold">Response time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {perCam.map((row) => (
                      <tr key={row.camId}>
                        <th scope="row" className="px-5 py-4 text-left font-medium">
                          {row.camName}
                          {row.flags.map((flag) => (
                            <span
                              key={flag.kind}
                              className="mt-1 block text-[11px] font-normal text-foreground/40"
                            >
                              {flag.message}
                            </span>
                          ))}
                        </th>
                        <td className="px-5 py-4 tabular-nums">{row.totals.clientsOwned}</td>
                        <td className="px-5 py-4 tabular-nums">{row.totals.contacted}</td>
                        <td className="px-5 py-4 tabular-nums">
                          {row.totals.respondingClients}
                          <span className="ml-2 text-[11px] text-foreground/40">
                            {row.totals.replyRate === null
                              ? "—"
                              : `${Math.round(row.totals.replyRate * 100)}%`}
                          </span>
                        </td>
                        <td className="px-5 py-4 tabular-nums">
                          {row.totals.conversions}
                          <span className="ml-2 text-[11px] text-foreground/40">
                          {row.totals.winRate === null
                            ? "—"
                            : `${Math.round(row.totals.winRate * 100)}%`}
                          </span>
                        </td>
                        <td className="px-5 py-4 tabular-nums">
                          {row.typical.hasEnoughData
                            ? formatResponseTime(row.typical.meanSeconds)
                            : "Not enough data"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Rise>
        </Group>

        <Group className="space-y-4">
          <Rise>
            <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">Pipeline stages</h2>
            <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
              How many clients sit at each stage right now. Choose a stage to see those clients.
            </p>
          </Rise>
          <Rise>
            {stages.length === 0 ? (
              <EmptyState message="No clients yet. Stages fill in as clients join the pipeline." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {stages.map(({ status, count }) => (
                  <Link
                    key={status}
                    href={`/clients?status=${encodeURIComponent(status)}`}
                    className="whitespace-nowrap rounded-full border border-rule bg-white px-3 py-1.5 font-body text-[13px] font-semibold tabular-nums text-ink transition-colors hover:border-lead-mid hover:text-lead focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
                  >
                    {formatOutreachStatus(status)} · {count.toLocaleString()}
                  </Link>
                ))}
              </div>
            )}
          </Rise>
        </Group>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Group className="space-y-4">
            <Rise className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">Ownership</h2>
                <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
                  How many clients each person owns. Choose a row to see their clients.
                </p>
              </div>
              <Link
                href="/admin/users"
                className="font-body text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
              >
                Manage team →
              </Link>
            </Rise>
            <Rise>
              {loads.length === 0 ? (
                <EmptyState message="No clients yet." />
              ) : (
                <ul className="divide-y divide-rule-soft rounded-panel border border-rule bg-white">
                  {loads.map((row) => (
                    <li key={row.ownerId ?? "unassigned"}>
                      <Link
                        href={`/clients?owner=${encodeURIComponent(row.ownerId ?? "unassigned")}`}
                        className="flex items-center justify-between gap-4 px-5 py-3 font-body text-sm transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead"
                      >
                        <span className="font-medium text-ink">{row.ownerName}</span>
                        <span className="font-semibold tabular-nums text-dim">
                          {row.count.toLocaleString()}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Rise>
          </Group>

          <Group className="space-y-4">
            <Rise>
              <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">Sectors</h2>
              <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
                Where the pipeline is concentrated, and how highly those clients score on
                average (out of 100).
              </p>
            </Rise>
            <Rise>
              {sectors.length === 0 ? (
                <EmptyState message="No clients yet." />
              ) : (
                <div className="overflow-x-auto rounded-panel border border-rule bg-white">
                  <table className="w-full border-collapse text-left font-body text-sm">
                    <thead>
                      <tr className="border-b border-rule-soft text-[13px] text-dim">
                        <th scope="col" className="px-5 py-3 font-semibold">Sector</th>
                        <th scope="col" className="px-5 py-3 text-right font-semibold">Clients</th>
                        <th scope="col" className="px-5 py-3 text-right font-semibold">Average score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule-soft">
                      {sectors.slice(0, SECTOR_ROWS).map((row) => (
                        <tr key={row.sector}>
                          <th scope="row" className="px-5 py-3 text-left font-medium text-ink">
                            {row.sector}
                          </th>
                          <td className="px-5 py-3 text-right tabular-nums text-dim">
                            {row.count.toLocaleString()}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-dim">
                            {row.avgScore === null ? "Not scored" : priorityScoreOutOf100(row.avgScore)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sectors.length > SECTOR_ROWS && (
                    <p className="border-t border-rule-soft px-5 py-2.5 font-body text-[12.5px] text-faint">
                      {(sectors.length - SECTOR_ROWS).toLocaleString()} smaller{" "}
                      {sectors.length - SECTOR_ROWS === 1 ? "sector" : "sectors"} not shown.
                    </p>
                  )}
                </div>
              )}
            </Rise>
          </Group>
        </div>
      </Stage>
    </div>
  );
}
