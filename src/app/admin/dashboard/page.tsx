// F180 — Admin Dashboard. Team-wide pipeline activity for admins.
//
// Read-only overview with funnel, stage strip, ownership load, stalled slice,
// growth curve, sector and band breakdowns.
//
// Navigation (AC3): links out to Review Queue (/admin/review, pending F181
// dedicated approvals tab), and Team Ownership (/admin/users + ?owner=
// drill-downs, F167) so the dashboard stays high-level and navigational.
//
// Freshness: dynamically rendered through the Supabase server client (request
// cookies). No cached snapshot in between — an admin who
// reloads sees every CAM's latest change.
//
// Tone performance (F209, P3) intentionally excluded — thin signal until F098
// volume builds. Band distribution shown (PM approved despite pending threshold
// confirmation per 06-predictions.md:33). Time-spent (F211) excluded per spec
// note "support, not punitive ranking" (PRD §17:757).

import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { StatCard } from "@/components/stat-card";
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import { DutyQueueCard } from "@/components/dashboard/duty-queue-card";
import { ImportHealthCard } from "@/components/dashboard/import-health-card";
import { fetchAdminQueueTally } from "@/lib/dashboard/admin-queue";
import { filterActiveSuppressed } from "@/lib/dashboard-metrics";
import type { DashboardOrgRow, OpenSuppression } from "@/lib/dashboard-metrics";
import { formatOutreachStatus } from "@/lib/organisation-format";
import {
  bandCounts,
  buildFunnelMetrics,
  organisationGrowthSeries,
  ownerLoad,
  pipelineCounts,
  sectorCounts,
} from "@/lib/admin/dashboard-metrics";
import type { DashboardClient } from "@/lib/admin/dashboard-metrics";
import { summariseImportHealth } from "./import-health";
import type { IngestionRunRow } from "../import-status/run-format";

const FETCH_STEP = 1000;

/**
 * How much of the run history one visit reads — the same window
 * `/admin/import-status` opens with. The card only ever shows the latest run
 * per source, but the window is what decides whether a second run for the same
 * source is in hand to compare against, and it keeps this read bounded as the
 * table grows.
 */
const INGESTION_WINDOW = 100;

type OrgRow = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
  owner: { full_name: string | null } | null;
  sector: string | null;
  city: string | null;
  created_at: string;
  updated_at: string;
};

type ScoreRow = {
  organisation_id: string;
  priority_score: number | null;
  priority_band: "high" | "medium" | "low" | null;
};

export default async function AdminDashboardPage() {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/dashboard",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  // Organisations: paginated walk, same as CAM dashboard
  // (PostgREST caps at 1000). Include sector/city for the sector slice and
  // created_at for the 30-day growth series (reused from CAM dashboard).
  const all: OrgRow[] = [];
  let listError: { message: string } | null = null;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("organisations")
      .select(
        "id, legal_name, outreach_status, owner_id, owner:users!organisations_owner_id_fkey(full_name), sector, city, created_at, updated_at",
      )
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + FETCH_STEP - 1)
      .overrideTypes<OrgRow[], { merge: false }>();
    if (error) {
      listError = error;
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < FETCH_STEP) break;
    from += FETCH_STEP;
  }

  if (listError) {
    await reportError(listError, { operation: "admin.dashboard.page_list" });
  }

  // Open suppressions: same filter as CAM dashboard (F022 AC3 — active suppressed
  // excluded from totals, pending stays until approved).
  const suppressions: OpenSuppression[] = [];
  let suppressionError: { message: string } | null = null;
  let sFrom = 0;
  while (!listError) {
    const { data, error } = await supabase
      .from("suppressions")
      .select("organisation_id, status")
      .in("status", ["pending", "active"])
      .order("organisation_id", { ascending: true })
      .range(sFrom, sFrom + FETCH_STEP - 1)
      .overrideTypes<OpenSuppression[], { merge: false }>();
    if (error) {
      suppressionError = error;
      break;
    }
    if (!data || data.length === 0) break;
    suppressions.push(...data);
    if (data.length < FETCH_STEP) break;
    sFrom += FETCH_STEP;
  }
  if (suppressionError) {
    await reportError(suppressionError, { operation: "admin.dashboard.page_suppressions" });
  }

  // Latest scores: admin-only read via RLS (active users can read), service_role
  // writes only. Paginated similarly.
  const scoreByOrg = new Map<string, ScoreRow>();
  let scoreError: { message: string } | null = null;
  let scFrom = 0;
  while (!listError) {
    const { data, error } = await supabase
      .from("latest_scores")
      .select("organisation_id, priority_score, priority_band")
      .order("organisation_id", { ascending: true })
      .range(scFrom, scFrom + FETCH_STEP - 1)
      .overrideTypes<ScoreRow[], { merge: false }>();
    if (error) {
      scoreError = error;
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) scoreByOrg.set(row.organisation_id, row);
    if (data.length < FETCH_STEP) break;
    scFrom += FETCH_STEP;
  }
  if (scoreError) {
    await reportError(scoreError, { operation: "admin.dashboard.page_scores" });
  }

  // The two things this page is supposed to answer that it never did: is
  // anything waiting on an admin, and is the register still moving. Both are
  // about the machine rather than the pipeline, and both fail soft — a broken
  // queue count must not take the funnel down with it.
  const [queueResult, ingestionResult] = await Promise.all([
    fetchAdminQueueTally(supabase),
    supabase
      .from("ingestion_runs")
      .select(
        "id, api_source, job_status, records_fetched, records_inserted, records_skipped, records_failed, records_flagged, started_at, completed_at, error_message, triggered_by",
      )
      .order("started_at", { ascending: false })
      .limit(INGESTION_WINDOW)
      .overrideTypes<IngestionRunRow[], { merge: false }>(),
  ]);

  if (queueResult.error) {
    await reportError(queueResult.error, { operation: "admin.dashboard.page_admin_queues" });
  }
  if (ingestionResult.error) {
    await reportError(ingestionResult.error, { operation: "admin.dashboard.page_ingestion_runs" });
  }

  const filteredRows: DashboardOrgRow[] = filterActiveSuppressed(
    all.map((r) => ({
      id: r.id,
      legal_name: r.legal_name,
      outreach_status: r.outreach_status,
      owner_id: r.owner_id,
      updated_at: r.updated_at,
      created_at: r.created_at,
    })),
    suppressions,
  );
  const visibleIds = new Set(filteredRows.map((r) => r.id));

  const clients: DashboardClient[] = all
    .filter((r) => visibleIds.has(r.id))
    .map((r) => {
      const score = scoreByOrg.get(r.id);
      return {
        id: r.id,
        legal_name: r.legal_name,
        outreach_status: r.outreach_status,
        owner_id: r.owner_id,
        owner_name: r.owner?.full_name ?? null,
        sector: r.sector,
        city: r.city,
        created_at: r.created_at,
        updated_at: r.updated_at,
        priority_score: score?.priority_score ?? null,
        priority_band: score?.priority_band ?? null,
      };
    });

  const funnel = buildFunnelMetrics(clients);
  const counts = pipelineCounts(
    clients.map((c) => ({
      id: c.id,
      legal_name: c.legal_name,
      outreach_status: c.outreach_status,
      owner_id: c.owner_id,
      owner_name: c.owner_name,
    })),
  );
  const bands = bandCounts(clients);
  const sectors = sectorCounts(clients);
  const loads = ownerLoad(clients);
  const growth = organisationGrowthSeries(
    filteredRows,
    30,
  );
  const suppressedCount = all.length - clients.length;

  // One clock for the whole page, so a run's "2 hours ago" and the growth
  // curve's day boundaries cannot disagree about when now is.
  const now = new Date();
  const importHealth = ingestionResult.error
    ? null
    : summariseImportHealth(ingestionResult.data ?? [], now);
  const unassignedOrgs = clients.filter((client) => client.owner_id === null).length;
  const dutyCounts = {
    unassignedOrgs,
    pendingSuppressions: queueResult.tally?.pendingSuppressions ?? 0,
    ownershipRequests: queueResult.tally?.ownershipRequests ?? 0,
    suggestedEdits: queueResult.tally?.suggestedEdits ?? 0,
    discrepancies: queueResult.tally?.discrepancies ?? 0,
  };
  // The number the header pill carries. Unassigned clients are part of it: they
  // are the queue an admin is most likely able to fix in one sitting.
  const openQueueTotal = queueResult.tally
    ? queueResult.tally.total + unassignedOrgs
    : null;

  const share = (value: number) =>
    funnel.totalCharities === 0 ? 0 : value / funnel.totalCharities;

  const shareCaption = (value: number) =>
    funnel.totalCharities === 0
      ? "No records yet"
      : `${Math.round(share(value) * 100)}% of the pipeline`;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-6xl space-y-10">
        <Rise className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              Admin dashboard
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-[1.7] text-foreground/65">
              Team-wide pipeline activity. Every filtered count below links into the team
              pipeline for the full list.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* AC3 Approvals: links to unified review queue (/admin/review)
                pending F181 dedicated approvals tab. It carries the count now:
                an admin landing on their own home page could not previously
                tell whether anything was waiting on them. */}
            <Link
              href="/admin/review"
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-rule bg-white px-4 py-2 text-sm font-bold text-ink transition-colors hover:border-lead-mid hover:text-lead focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
            >
              Review queue
              {openQueueTotal !== null && openQueueTotal > 0 && (
                <span className="rounded-full bg-lead px-2 py-0.5 text-[12px] leading-none font-semibold tabular-nums text-paper">
                  {openQueueTotal.toLocaleString()}
                </span>
              )}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </Rise>

        {listError ? (
          <Rise>
            <InlineAlert
              variant="page"
              message="The dashboard could not be loaded. This has been recorded — refresh and try again."
            />
          </Rise>
        ) : clients.length === 0 ? (
          <Rise>
            <EmptyState message="No clients yet. They appear here as soon as one joins the pipeline." />
          </Rise>
        ) : (
          <>
            {/* Degraded, not fatal: a failed suppressions or latest_scores walk
                would otherwise leave the figures silently wrong — a suppression
                read failure keeps actively-suppressed clients in every total, a
                score failure drops scored clients into "unscored". Only the
                org-list failure above is a hard error. */}
            {(suppressionError || scoreError) && (
              <Rise>
                <InlineAlert
                  variant="page"
                  tone="warning"
                  message={
                    suppressionError && scoreError
                      ? "Some figures are incomplete — suppression status and priority scores could not be fully loaded, so totals, bands and mean scores may be inaccurate. This has been recorded — refresh and try again."
                      : suppressionError
                        ? "Suppression status could not be fully loaded, so totals may include actively-suppressed clients. This has been recorded — refresh and try again."
                        : "Priority scores could not be fully loaded, so band and mean-score figures are incomplete. This has been recorded — refresh and try again."
                  }
                />
              </Rise>
            )}
            {/* The machine, before the pipeline. An admin's first question on
                this page is "is anything waiting, and is anything broken" — the
                queue counts and the import runs are the two halves of that, and
                neither was on this screen until now. */}
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <Rise>
                {queueResult.tally ? (
                  <DutyQueueCard counts={dutyCounts} />
                ) : (
                  <section className="rounded-panel border border-rule bg-white px-5 py-4">
                    <h2 className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                      Duty queue
                    </h2>
                    <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
                      The queue counts could not be loaded. Refresh and try again.
                    </p>
                  </section>
                )}
              </Rise>

              <Rise>
                <ImportHealthCard summary={importHealth} />
              </Rise>
            </div>

            {/* Growth curve — same 30-day cumulative as CAM dashboard, last point = total */}
            <Group className="space-y-4">
              <Rise>
                <ProgressMetricCard
                  size="lg"
                  title="Total organisations"
                  total={funnel.totalCharities.toLocaleString()}
                  unit="organisations"
                  accent="brand"
                  data={growth.map((p) => ({ date: p.date, value: p.value }))}
                  period="Past 30 days"
                  periodOptions={[
                    { label: "Past 7 days", points: 7 },
                    { label: "Past 14 days", points: 14 },
                    { label: "Past 30 days" },
                  ]}
                  allowCustomRange
                  showFooter={false}
                  className="rounded-2xl border-black/[0.06] shadow-sm"
                />
              </Rise>
              {suppressedCount > 0 && (
                <Rise>
                  <p className="text-xs text-foreground/40">
                    {suppressedCount.toLocaleString()} suppressed{" "}
                    {suppressedCount === 1 ? "client" : "clients"} excluded from totals
                    (active suppressions).
                  </p>
                </Rise>
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Rise>
                  <StatCard
                    label="Contacted"
                    value={funnel.contacted}
                    share={share(funnel.contacted)}
                    caption={shareCaption(funnel.contacted)}
                  />
                </Rise>
                <Rise>
                  <StatCard
                    label="Responses received"
                    value={funnel.responsesReceived}
                    share={share(funnel.responsesReceived)}
                    caption={shareCaption(funnel.responsesReceived)}
                  />
                </Rise>
                <Rise>
                  <StatCard
                    label="Converted"
                    value={funnel.converted}
                    share={share(funnel.converted)}
                    caption={shareCaption(funnel.converted)}
                    emphasis
                  />
                </Rise>
              </div>
              <Rise className="flex flex-wrap gap-2 text-xs text-foreground/40">
                <span>
                  Conversion rate:{" "}
                  <span className="font-bold text-foreground/70">
                    {funnel.contacted === 0 ? "—" : `${(funnel.conversionRate * 100).toFixed(1)}%`}
                  </span>{" "}
                  of contacted
                </span>
                <span className="opacity-40">·</span>
                <span>
                  No response:{" "}
                  <span className="font-bold text-foreground/70">
                    {funnel.contacted === 0 ? "—" : `${(funnel.noResponseRate * 100).toFixed(1)}%`}
                  </span>
                </span>
              </Rise>
            </Group>

            {/* Stage strip — each pill links with ?status= */}
            <Group className="space-y-3">
              <Rise>
                <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  Pipeline stages
                </h2>
              </Rise>
              <Rise className="flex flex-wrap gap-2">
                {counts.map(({ status, count }) => (
                  <Link
                    key={status}
                    href={`/admin/dashboard?status=${encodeURIComponent(status)}`}
                    className="whitespace-nowrap rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-bold tabular-nums text-foreground/70 hover:border-brand hover:text-brand"
                  >
                    {formatOutreachStatus(status)} · {count.toLocaleString()}
                  </Link>
                ))}
              </Rise>
              <Rise>
                <p className="text-xs text-foreground/40">
                  Counts cover the whole pipeline, before any filter — same definition as the
                  team pipeline strip.
                </p>
              </Rise>
            </Group>

            {/* Ownership load + band distribution side by side */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Group className="space-y-3">
                <Rise className="flex items-baseline justify-between">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                    Ownership
                  </h2>
                  {/* AC3 Team Ownership: links directly to /admin/users directory (F167) */}
                  <Link
                    href="/admin/users"
                    className="text-xs font-semibold text-foreground/50 hover:text-brand"
                  >
                    Manage team →
                  </Link>
                </Rise>
                <Rise>
                  <div className="rounded-2xl border border-black/[0.06] bg-white shadow-sm">
                    <div className="divide-y divide-black/5">
                      {loads.map((row) => (
                        <Link
                          key={row.ownerId ?? "unassigned"}
                          href={
                            row.ownerId
                              ? `/admin/users?owner=${encodeURIComponent(row.ownerId)}`
                              : "/admin/users?owner=unassigned"
                          }
                          className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-black/[0.02]"
                        >
                          <span className="font-medium text-foreground/80">{row.ownerName}</span>
                          <span className="tabular-nums font-bold text-foreground/60">
                            {row.count.toLocaleString()}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </Rise>
              </Group>

              <Group className="space-y-3">
                <Rise>
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                    Priority bands
                  </h2>
                  <p className="mt-1 text-xs leading-[1.6] text-foreground/40">
                    SCOUT bands — high ≥0.70, medium ≥0.40 (thresholds pending team confirmation).
                  </p>
                </Rise>
                <Rise>
                  <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
                    <div className="space-y-3">
                      {bands.map(({ band, count }) => {
                        const pct = funnel.totalCharities === 0 ? 0 : (count / funnel.totalCharities) * 100;
                        return (
                          <div key={band} className="flex items-center gap-3">
                            <span className="w-24 text-xs font-bold uppercase tracking-[0.08em] text-foreground/50">
                              {band}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                              <div
                                className={`h-full rounded-full ${band === "high" ? "bg-brand" : band === "medium" ? "bg-black/40" : band === "low" ? "bg-black/20" : "bg-black/[0.08]"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-12 text-right text-xs tabular-nums font-bold text-foreground/60">
                              {count.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Rise>
              </Group>
            </div>

            {/* Sector breakdown */}
            <Group className="space-y-3">
              <Rise>
                <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                  Sectors
                </h2>
                <p className="mt-1 text-xs leading-[1.6] text-foreground/40">
                  Where the pipeline is concentrated and its mean SCOUT score.
                </p>
              </Rise>
              <Rise>
                <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-black/10">
                          <th className="p-4 pb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                            Sector
                          </th>
                          <th className="p-4 pb-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                            Clients
                          </th>
                          <th className="p-4 pb-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                            Mean score
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectors.slice(0, 12).map((row) => (
                          <tr key={row.sector} className="border-b border-black/5 last:border-b-0">
                            <td className="p-4 font-medium text-foreground/80">{row.sector}</td>
                            <td className="p-4 text-right tabular-nums text-foreground/70">
                              {row.count.toLocaleString()}
                            </td>
                            <td className="p-4 text-right tabular-nums text-foreground/70">
                              {row.avgScore === null ? "—" : row.avgScore.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Rise>
            </Group>
          </>
        )}
      </Stage>
    </div>
  );
}
