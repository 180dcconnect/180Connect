// F182: Team Pipeline View.
//
// One admin view of every client across the team with its current pipeline
// stage (F145), filterable by stage and by owning CAM (F167). Read-only on
// purpose: the issue's scope is oversight, and every legitimate status write
// already runs through the audited `set_outreach_status` RPCs — this page adds
// no second way to change a pipeline.
//
// Freshness (AC3): the Supabase server client rides the request cookies, so
// the page is dynamically rendered on every visit. A status any CAM changed a
// moment ago is here the next time the admin loads or navigates — no cached
// snapshot in between.
//
// The counts strip is computed over the whole dataset before filtering, so it
// keeps answering "how many clients are stuck at X" for the whole team even
// while the table below is narrowed.

import { redirect } from "next/navigation";
import Link from "next/link";

import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { Group, Rise } from "@/components/dashboard-stage";
import { SearchRail } from "@/components/search-rail";
import {
  formatOutreachStatus,
  PIPELINE_STATUSES,
} from "@/lib/organisation-format";
import {
  DEFAULT_FOLLOW_UP_THRESHOLDS,
  type FollowUpThresholds,
} from "@/lib/outreach/follow-up-recommendations";
import { stalledClients } from "@/lib/outreach/stall-detection";
import {
  filterTeamPipelineClients,
  ownerOptions,
  paginateTeamPipelineClients,
  parseTeamPipelineFilters,
  pipelineCounts,
  sortTeamPipelineClients,
  UNASSIGNED_OWNER,
  type TeamPipelineClient,
} from "@/lib/admin/team-pipeline";
import { TeamPipelineTable } from "./team-pipeline-table";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** PostgREST caps one response at 1000 rows — walk the range like /clients does. */
const FETCH_STEP = 1000;

type OrgRow = {
  id: string;
  legal_name: string;
  outreach_status: string;
  owner_id: string | null;
  owner: { full_name: string | null } | null;
};

export default async function AdminTeamPipelinePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authorization = await getCurrentActor("user:manage", {
    route: "/admin/team-pipeline",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const params = await searchParams;
  const { filters, page } = parseTeamPipelineFilters(params);

  const supabase = await createClient();
  const all: OrgRow[] = [];
  let listError: { message: string } | null = null;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("organisations")
      .select(
        "id, legal_name, outreach_status, owner_id, owner:users!organisations_owner_id_fkey(full_name)",
      )
      .order("legal_name", { ascending: true })
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
    await reportError(listError, { operation: "admin.team_pipeline.page_list" });
  }

  const baseClients: TeamPipelineClient[] = all.map((row) => ({
    id: row.id,
    legal_name: row.legal_name,
    outreach_status: row.outreach_status,
    owner_id: row.owner_id,
    owner_name: row.owner?.full_name ?? null,
  }));

  // F183 — stall flags are computed live on every render so the view is never
  // stale (and the daily cron records the same set to audit_log for AC3).
  // All three reads degrade gracefully — a failed activity fetch simply means
  // no client is flagged stalled on this render, rather than hiding the table.
  let clients: TeamPipelineClient[] = baseClients;
  if (baseClients.length > 0) {
    const now = new Date();
    const RPC_CHUNK = 500;
    const ACTION_STEP = 1000;

    const [{ data: prefRows, error: prefError }, { data: openActions, error: openError }] =
      await Promise.all([
        supabase
          .from("outreach_preferences")
          .select("user_id, first_follow_up_days, second_follow_up_days")
          .overrideTypes<
            { user_id: string; first_follow_up_days: number | null; second_follow_up_days: number | null }[],
            { merge: false }
          >(),
        (async () => {
          const ids = new Set<string>();
          let offset = 0;
          while (true) {
            const { data, error } = await supabase
              .from("actions")
              .select("organisation_id")
              .eq("status", "open")
              .order("organisation_id", { ascending: true })
              .range(offset, offset + ACTION_STEP - 1)
              .overrideTypes<{ organisation_id: string }[], { merge: false }>();
            if (error) return { data: [...ids], error };
            if (!data || data.length === 0) break;
            for (const row of data) ids.add(row.organisation_id);
            if (data.length < ACTION_STEP) break;
            offset += ACTION_STEP;
          }
          return { data: [...ids], error: null as null };
        })(),
      ]);

    if (prefError) {
      await reportError(prefError, { operation: "admin.team_pipeline.preferences_list" });
    }
    if (openError) {
      await reportError(openError, { operation: "admin.team_pipeline.open_actions_list" });
    }

    const thresholdsByOwner = new Map<string, FollowUpThresholds>();
    for (const row of prefRows ?? []) {
      thresholdsByOwner.set(row.user_id, {
        first: row.first_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.first,
        second: row.second_follow_up_days ?? DEFAULT_FOLLOW_UP_THRESHOLDS.second,
      });
    }

    const activityByOrg = new Map<string, { lastEmailSentAt: string | null; lastReplyReceivedAt: string | null; lastStatusChangeAt: string | null }>();
    for (let i = 0; i < baseClients.length; i += RPC_CHUNK) {
      const chunkIds = baseClients.slice(i, i + RPC_CHUNK).map((c) => c.id);
      const { data, error } = await supabase.rpc("get_clients_last_activity", {
        p_organisation_ids: chunkIds,
      });
      if (error) {
        await reportError(error, { operation: "admin.team_pipeline.activity_chunk" });
        continue;
      }
      for (const row of (data ?? []) as {
        organisation_id: string;
        last_email_sent_at: string | null;
        last_reply_received_at: string | null;
        last_status_change_at: string | null;
      }[]) {
        activityByOrg.set(row.organisation_id, {
          lastEmailSentAt: row.last_email_sent_at,
          lastReplyReceivedAt: row.last_reply_received_at,
          lastStatusChangeAt: row.last_status_change_at,
        });
      }
    }

    const openIds = new Set<string>(openActions ?? []);
    const candidates = baseClients.map((c) => ({
      id: c.id,
      legal_name: c.legal_name,
      outreach_status: c.outreach_status,
      owner_id: c.owner_id,
    }));
    const flags = stalledClients(candidates, activityByOrg, thresholdsByOwner, openIds, now);
    const flagById = new Map(flags.map((f) => [f.organisationId, f.daysWaiting]));
    clients = baseClients.map((c) => {
      const days = flagById.get(c.id);
      return days == null ? { ...c, isStalled: false } : { ...c, isStalled: true, stalledDaysWaiting: days };
    });
  }

  // Counts describe the whole pipeline; filters only narrow the table.
  const counts = pipelineCounts(baseClients);
  const stalledCount = clients.filter((c) => c.isStalled).length;
  const filtered = sortTeamPipelineClients(filterTeamPipelineClients(clients, filters));
  const paginated = paginateTeamPipelineClients(filtered, page);

  const owners = ownerOptions(baseClients);
  const filtersActive =
    filters.q !== "" || filters.statuses.length > 0 || filters.owners.length > 0 || filters.stalledOnly;

  function hrefFor(changes: { q?: string; statuses?: string[]; owners?: string[]; stalledOnly?: boolean; page?: number }) {
    const next = new URLSearchParams();
    const q = changes.q ?? filters.q;
    const statuses = changes.statuses ?? filters.statuses;
    const owners = changes.owners ?? filters.owners;
    const stalledOnly = changes.stalledOnly ?? filters.stalledOnly;
    if (q) next.set("q", q);
    for (const status of statuses) next.append("status", status);
    for (const owner of owners) next.append("owner", owner);
    if (stalledOnly) next.set("stalled", "1");
    const targetPage = changes.page ?? paginated.page;
    if (targetPage > 1) next.set("page", String(targetPage));
    const query = next.toString();
    return query ? `/admin/team-pipeline?${query}` : "/admin/team-pipeline";
  }

  function toggleStatusHref(status: string): string {
    const active = filters.statuses.includes(status);
    return hrefFor({
      statuses: active
        ? filters.statuses.filter((value) => value !== status)
        : [...filters.statuses, status],
    });
  }

  const ownerLabelById = new Map(owners.map((owner) => [owner.id, owner.name]));

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <SearchRail
        className="max-w-6xl"
        heading={
          <>
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              Team pipeline
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-[1.7] text-foreground/65">
              Every client across the whole team and where each one stands in
              the pipeline. Pick a stage or a CAM to narrow the list — the
              counts below always cover everyone.
            </p>
          </>
        }
        bar={
          <BrandSearchBar
            placeholder="Search clients for"
            subjects={["clients", "stages", "CAMs"]}
            defaultQuery={filters.q}
            params={{ "Filter by stage": "status", "Filter by CAM": "owner" }}
            categories={{
              "Filter by stage": PIPELINE_STATUSES.map((status) => ({
                label: formatOutreachStatus(status),
                value: status,
              })),
              "Filter by CAM": [
                ...owners.map((owner) => ({ label: owner.name, value: owner.id })),
                { label: "Unassigned", value: UNASSIGNED_OWNER },
              ],
            }}
            defaultFilters={[
              ...filters.statuses.map((status) => ({
                category: "Filter by stage",
                label: formatOutreachStatus(status),
                value: status,
              })),
              ...filters.owners.map((owner) => ({
                category: "Filter by CAM",
                label:
                  owner === UNASSIGNED_OWNER ? "Unassigned" : (ownerLabelById.get(owner) ?? owner),
                value: owner,
              })),
            ]}
          />
        }
      >
        {listError ? (
          <Rise>
            <InlineAlert
              variant="page"
              message="The team pipeline could not be loaded. This has been recorded — refresh and try again."
            />
          </Rise>
        ) : (
          <Group className="space-y-4">
            <Rise className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                <span className="tabular-nums">{paginated.total.toLocaleString()}</span> client
                {paginated.total === 1 ? "" : "s"}
                {filtersActive ? " matching" : " in the pipeline"}
              </p>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/25">
                Live from the database — reflects every CAM&apos;s latest change
              </p>
            </Rise>

            <Rise className="flex flex-wrap gap-2">
              {stalledCount > 0 && (
                <Link
                  aria-pressed={filters.stalledOnly}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors ${
                    filters.stalledOnly
                      ? "border-red-300 bg-red-50 text-red-700"
                      : "border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50"
                  }`}
                  href={hrefFor({ stalledOnly: !filters.stalledOnly })}
                >
                  Stalled · {stalledCount.toLocaleString()}
                </Link>
              )}
              {counts.length > 0 &&
                counts.map(({ status, count }) => {
                  const active = filters.statuses.includes(status);
                  return (
                    <Link
                      aria-pressed={active}
                      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors ${
                        active
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-black/10 bg-white text-foreground/70 hover:border-brand hover:text-brand"
                      }`}
                      href={toggleStatusHref(status)}
                      key={status}
                    >
                      {formatOutreachStatus(status)} · {count.toLocaleString()}
                    </Link>
                  );
                })}
            </Rise>

            {paginated.rows.length > 0 ? (
              <>
                <Rise>
                  <TeamPipelineTable rows={paginated.rows} />
                </Rise>
                {paginated.pageCount > 1 && (
                  <Rise className="flex items-center justify-between gap-4">
                    {paginated.page > 1 ? (
                      <Link className="text-sm font-bold text-brand hover:underline" href={hrefFor({ page: paginated.page - 1 })}>
                        ← Previous
                      </Link>
                    ) : (
                      <span />
                  )}
                    <p className="text-xs font-bold tabular-nums text-foreground/50">
                      Page <span className="tabular-nums">{paginated.page}</span> of{" "}
                      <span className="tabular-nums">{paginated.pageCount}</span>
                    </p>
                    {paginated.page < paginated.pageCount ? (
                      <Link className="text-sm font-bold text-brand hover:underline" href={hrefFor({ page: paginated.page + 1 })}>
                        Next →
                      </Link>
                    ) : (
                      <span />
                    )}
                  </Rise>
                )}
              </>
            ) : (
              <Rise>
                <EmptyState
                  message={
                    filtersActive
                      ? "No clients match these filters."
                      : "No clients yet. They appear here as soon as one joins the pipeline."
                  }
                />
              </Rise>
            )}
          </Group>
        )}
      </SearchRail>
    </div>
  );
}
