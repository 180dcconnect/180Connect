// F039: Import Status Tracking.
//
// Permission: "platform-settings:manage" is used as the closest existing fit
// (admin-only, matches ingestion_runs' RLS policy per F038's migration
// comment: "SELECT admin-only"). No dedicated "view import status"
// permission exists in src/lib/auth/permissions.ts yet — this is an
// assumption, not a confirmed decision; worth checking whether the team
// wants a dedicated permission added to the matrix instead.
//
// AC3 ("failed runs visible without checking server logs"): a failed run shows
// its error_message on the row itself and again, in full, in the expanded
// panel — knowing something failed without knowing why still sends someone to
// the logs, which is what this AC exists to avoid.
//
// records_flagged (F049 AC3): a status-recheck run's flagged count, same
// persistent-history treatment as every other outcome count on this page.
// Always 0 for a non-status-recheck run — nothing else here flags records.
//
// Rebuilt onto the design system (docs/design-system.md §Inside the app), the
// same language as /dashboard, /clients and /admin/audit-log: bone ground with
// white cards floating on it, a display heading against 11px labels, a staged
// blur-up entrance from the shared brand variants, and the machine's vocabulary
// translated in one pure module (run-format.ts) rather than printed raw.
//
// The status pill is deliberately untouched. `StatusBadge` and its palette in
// status-helpers.ts are what people already read this page's status from; the
// icon disc and count chips take their colours *from* it rather than proposing
// a second set.
//
// The root element is a `div`, not a `main`: the admin layout's AppShell
// already renders the `main` this is slotted into.

import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { Group, Rise } from "@/components/dashboard-stage";
import { SearchRail } from "@/components/search-rail";
import { groupByDay } from "@/lib/display-format";
import { ImportFeed } from "./import-feed";
import { describeRun, formatSource, matchesRunQuery, type IngestionRunRow } from "./run-format";
import { labelForStatus } from "./status-helpers.ts";

export type { IngestionRunRow };

// Next.js 16: searchParams is a Promise on App Router pages — same pattern as
// src/app/admin/audit-log/page.tsx.
type SearchParams = Promise<{ source?: string; status?: string; q?: string }>;

/** How many runs one visit reads. A window, not the whole history. */
const WINDOW = 100;

/** Category label → query parameter, for the shared brand search bar. */
const FILTER_PARAMS = {
  "Filter by source": "source",
  "Filter by outcome": "status",
} as const;

/** The four `job_status` values, in the order a run passes through them. */
const STATUSES = ["running", "completed", "partial", "failed"] as const;

export default async function AdminImportStatusPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const authorization = await getCurrentActor("platform-settings:manage", {
    route: "/admin/import-status",
  });
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const { source: sourceFilter, status: statusFilter, q: search } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("ingestion_runs")
    .select(
      "id, api_source, job_status, records_fetched, records_inserted, records_skipped, records_failed, records_flagged, started_at, completed_at, error_message",
    )
    .order("started_at", { ascending: false })
    .limit(WINDOW);

  if (sourceFilter) query = query.eq("api_source", sourceFilter);
  if (statusFilter) query = query.eq("job_status", statusFilter);

  const { data: runs, error } = await query.overrideTypes<IngestionRunRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.import_status.page_list" });
  }

  // One clock for the whole page, so two runs a millisecond apart cannot land in
  // different day groups or disagree about what "2 hours ago" means.
  const now = new Date();
  const described = (runs ?? []).map((run) => describeRun(run, now));

  // Free text is matched against the *rendered* run rather than pushed into the
  // query: someone searching "partially succeeded" is reading this page, not the
  // database, which only knows `partial`. It filters within the window above.
  const views = search ? described.filter((view) => matchesRunQuery(view, search)) : described;
  const groups = groupByDay(views);

  const filtersActive = Boolean(sourceFilter || statusFilter || search);
  const recordsAdded = views.reduce(
    (total, view) => total + (view.counts.find((count) => count.label === "Added")?.value ?? 0),
    0,
  );
  const failures = views.filter((view) => view.status === "failed").length;

  // The sources that have actually run, so the filter offers something that
  // returns rows — plus whichever is filtered on, so its chip is still named
  // when the filter matches nothing.
  const sourceTokens = Array.from(
    new Set([...(runs ?? []).map((run) => run.api_source), ...(sourceFilter ? [sourceFilter] : [])]),
  );

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <SearchRail
        className="max-w-6xl"
        stageClassName="space-y-10"
        heading={
          <>
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-black leading-[1] tracking-[-0.03em]">
              Import status
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-[1.7] text-foreground/65">
              Every data ingestion run, most recent first — what it fetched, what
              it added, and why it stopped if it did. Open a run for the full
              record counts.
            </p>
          </>
        }
        bar={
            <BrandSearchBar
              placeholder="Search the runs for"
              subjects={["sources", "outcomes", "failures", "records"]}
              defaultQuery={search ?? ""}
              params={FILTER_PARAMS}
              defaultFilters={[
                ...(sourceFilter
                  ? [
                      {
                        category: "Filter by source",
                        label: formatSource(sourceFilter),
                        value: sourceFilter,
                      },
                    ]
                  : []),
                ...(statusFilter
                  ? [
                      {
                        category: "Filter by outcome",
                        label: labelForStatus(statusFilter),
                        value: statusFilter,
                      },
                    ]
                  : []),
              ]}
              categories={{
                "Filter by source": sourceTokens
                  .map((token) => ({ label: formatSource(token), value: token }))
                  .sort((a, b) => a.label.localeCompare(b.label)),
                "Filter by outcome": STATUSES.map((status) => ({
                  label: labelForStatus(status),
                  value: status,
                })),
              }}
            />
        }
      >
        {error ? (
          <Rise>
            <p
              role="alert"
              className="rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
            >
              Import history could not be loaded. This has been recorded — refresh
              and try again.
            </p>
          </Rise>
        ) : (
          <Group className="space-y-4">
            <Rise className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                <span className="tabular-nums">{views.length}</span> run
                {views.length === 1 ? "" : "s"}
                {filtersActive ? " matching" : ""}
                {views.length > 0 && (
                  <>
                    {" · "}
                    <span className="tabular-nums">{recordsAdded.toLocaleString()}</span> record
                    {recordsAdded === 1 ? "" : "s"} added
                    {failures > 0 && (
                      <>
                        {" · "}
                        <span className="text-red-800">
                          <span className="tabular-nums">{failures}</span> failed
                        </span>
                      </>
                    )}
                  </>
                )}
              </p>
              {described.length === WINDOW && (
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/25">
                  Most recent {WINDOW} runs
                </p>
              )}
            </Rise>

            {views.length > 0 ? (
              <ImportFeed groups={groups} />
            ) : (
              <Rise>
                <div className="rounded-2xl border border-black/[0.06] bg-white px-5 py-10 shadow-sm">
                  <p className="text-center text-sm leading-[1.7] text-foreground/65">
                    {filtersActive
                      ? "No import runs match this filter."
                      : "No import runs recorded yet. They appear here the first time an ingestion job runs."}
                  </p>
                </div>
              </Rise>
            )}
          </Group>
        )}
      </SearchRail>
    </div>
  );
}
