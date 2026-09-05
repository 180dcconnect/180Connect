import { redirect } from "next/navigation";

import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/stat-card";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import {
  filterActiveSuppressed,
  type DashboardOrgRow,
  type OpenSuppression,
} from "@/lib/dashboard-metrics";
import { formatResponseTime } from "@/lib/reply-analytics";
import { formatRate, type CamReplyRow, type SentMessageRow } from "@/lib/cam-analytics";
import {
  conversionsOverTime,
  perCamAnalytics,
  sortByNeed,
  teamTotals,
  type OutcomeRow,
} from "@/lib/admin/manager-analytics";

/**
 * F210/F212 — the team-wide read of the analytics each CAM sees for themselves
 * on /analytics.
 *
 * Every panel is fed by its own independently-caught query, so a source that
 * fails or has no rows yet shows its own empty state instead of blanking the
 * page — F212 AC3 asks for exactly that, since several of its stated
 * dependencies may never be finished.
 */

const FETCH_STEP = 1000;

type CamRow = { id: string; full_name: string | null; role: string };

export default async function AdminAnalyticsPage() {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/analytics",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

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

  const [organisations, openSuppressions, messages, replies, outcomes, cams] = await Promise.all([
    fetchPaged<DashboardOrgRow>((from) =>
      supabase
        .from("organisations")
        .select("id, legal_name, outreach_status, owner_id, updated_at, created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + FETCH_STEP - 1)
        .overrideTypes<DashboardOrgRow[], { merge: false }>(),
    ),
    fetchPaged<OpenSuppression>((from) =>
      supabase
        .from("suppressions")
        .select("organisation_id, status")
        .in("status", ["pending", "active"])
        .order("organisation_id", { ascending: true })
        .range(from, from + FETCH_STEP - 1)
        .overrideTypes<OpenSuppression[], { merge: false }>(),
    ),
    fetchPaged<SentMessageRow>((from) =>
      supabase
        .from("outreach_messages")
        .select("id, organisation_id, sent_by_user_id, sent_at")
        .eq("send_status", "sent")
        .order("sent_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + FETCH_STEP - 1)
        .overrideTypes<SentMessageRow[], { merge: false }>(),
    ),
    fetchPaged<CamReplyRow>((from) =>
      supabase
        .from("reply_events")
        .select("id, organisation_id, response_time_seconds")
        .order("received_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + FETCH_STEP - 1)
        .overrideTypes<CamReplyRow[], { merge: false }>(),
    ),
    fetchPaged<OutcomeRow>((from) =>
      supabase
        .from("outcomes")
        .select("id, organisation_id, outcome_type, created_at")
        .eq("outcome_type", "converted")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + FETCH_STEP - 1)
        .overrideTypes<OutcomeRow[], { merge: false }>(),
    ),
    fetchPaged<CamRow>((from) =>
      supabase
        .from("users")
        .select("id, full_name, role")
        .in("role", ["cam", "admin"])
        .eq("is_active", true)
        .order("full_name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + FETCH_STEP - 1)
        .overrideTypes<CamRow[], { merge: false }>(),
    ),
  ]);

  const sources = {
    "admin.analytics.organisations": organisations,
    "admin.analytics.suppressions": openSuppressions,
    "admin.analytics.sent_messages": messages,
    "admin.analytics.reply_events": replies,
    "admin.analytics.outcomes": outcomes,
    "admin.analytics.users": cams,
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

  const rows = filterActiveSuppressed(organisations.data ?? [], openSuppressions.data ?? []);
  const camList = (cams.data ?? []).map((cam) => ({
    id: cam.id,
    name: cam.full_name ?? "Unnamed user",
  }));

  const perCam = sortByNeed(
    perCamAnalytics(rows, messages.data ?? [], replies.data ?? [], camList),
  );
  const totals = teamTotals(perCam);
  const conversionSeries = conversionsOverTime(outcomes.data ?? [], 90);

  const share = (value: number) =>
    totals.contacted === 0 ? 0 : Math.min(value / totals.contacted, 1);

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-10">
        <Rise>
          <header>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Whole team · admin only
            </p>
            <h1 className="mt-2 font-body text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1] tracking-[-0.03em]">
              Team analytics
            </h1>
          </header>
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
            <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">Across the team</h2>
          </Rise>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Rise>
              <StatCard
                label="Clients owned"
                value={totals.clientsOwned}
                share={totals.clientsOwned === 0 ? 0 : totals.contacted / totals.clientsOwned}
                caption={`${totals.contacted.toLocaleString()} contacted · ${totals.cams} CAM${totals.cams === 1 ? "" : "s"}`}
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
                caption={`${formatRate(totals.contacted === 0 ? null : totals.respondingClients / totals.contacted)}`}
              />
            </Rise>
            <Rise>
              <StatCard
                label="Conversions"
                value={totals.conversions}
                share={share(totals.conversions)}
                caption={formatRate(
                  totals.contacted === 0 ? null : totals.conversions / totals.contacted,
                )}
                emphasis
              />
            </Rise>
          </div>
        </Group>

        <Group className="space-y-4">
          <Rise>
            <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">
              Conversions over time
            </h2>
          </Rise>
          <Rise>
            {conversionSeries.some((point) => point.value > 0) ? (
              <ProgressMetricCard
                size="lg"
                title="Conversions"
                total={totals.conversions.toLocaleString()}
                unit="conversions"
                accent="brand"
                data={conversionSeries}
                period="Past 30 days"
                periodOptions={[
                  { label: "Past 7 days", points: 7 },
                  { label: "Past 30 days", points: 30 },
                  { label: "Past quarter", points: 90 },
                ]}
                allowCustomRange
                showFooter={false}
                className="rounded-2xl border-black/[0.06] shadow-sm"
              />
            ) : (
              <EmptyState message="No conversions recorded in the last quarter. This chart fills in as clients convert." />
            )}
          </Rise>
        </Group>

        <Group className="space-y-4">
          <Rise>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-body text-xl font-semibold tracking-[-0.02em]">By CAM</h2>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                {totals.camsNeedingSupport > 0
                  ? `${totals.camsNeedingSupport} may need support`
                  : "Nobody flagged"}
              </p>
            </div>
          </Rise>
          <Rise>
            {perCam.length === 0 ? (
              <EmptyState message="No active CAMs yet. Invite one from the team page and their numbers appear here." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.06] text-left text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                      <th scope="col" className="px-5 py-3 font-bold">CAM</th>
                      <th scope="col" className="px-5 py-3 font-bold">Clients</th>
                      <th scope="col" className="px-5 py-3 font-bold">Contacted</th>
                      <th scope="col" className="px-5 py-3 font-bold">Replies</th>
                      <th scope="col" className="px-5 py-3 font-bold">Conversions</th>
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
                            {row.totals.conversionRate === null
                              ? "—"
                              : `${Math.round(row.totals.conversionRate * 100)}%`}
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
      </Stage>
    </div>
  );
}
