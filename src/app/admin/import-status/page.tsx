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
import { InlineAlert } from "@/components/ui/inline-alert";
import { EmptyState } from "@/components/ui/empty-state";
import { BrandSearchBar } from "@/components/brand/search-bar";
import { Group, Rise } from "@/components/dashboard-stage";
import { SearchRail } from "@/components/search-rail";
import { groupByDay } from "@/lib/display-format";
import { DataImportsHeader } from "../data-imports-header";
import { ImportFeed } from "./import-feed";
import { IngestionGuide } from "./ingestion-guide";
import { describeRun, formatSource, matchesRunQuery, type IngestionRunRow } from "./run-format";
import { labelForStatus } from "./status-helpers.ts";

export type { IngestionRunRow };

// Next.js 16: searchParams is a Promise on App Router pages — same pattern as
// src/app/admin/audit-log/page.tsx.
type SearchParams = Promise<{
  source?: string;
  status?: string;
  date?: string;
  trigger?: string;
  activity?: string;
  q?: string;
}>;

/** How many runs one visit reads. A window, not the whole history. */
const WINDOW = 100;

/** Category label → query parameter, for the shared brand search bar. */
const FILTER_PARAMS = {
  "Filter by source": "source",
  "Filter by outcome": "status",
  "Filter by date": "date",
  "Filter by trigger": "trigger",
  "Filter by activity": "activity",
} as const;

/** The four `job_status` values, in the order a run passes through them. */
const STATUSES = ["running", "completed", "partial", "failed"] as const;

/** The two Charity Commission pipelines — unified so filtering either matches both. */
const CHARITY_COMMISSION_SOURCES = ["charity_commission", "charity_commission_bulk"] as const;

const DATE_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Past 7 days", value: "7d" },
  { label: "Past 30 days", value: "30d" },
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" },
];

const TRIGGER_OPTIONS = [
  { label: "Manual import", value: "manual" },
  { label: "Scheduled run", value: "schedule" },
];

const ACTIVITY_OPTIONS = [
  { label: "With records added", value: "added" },
  { label: "With failed records", value: "failed_records" },
  { label: "With flagged records", value: "flagged_records" },
  { label: "No records added", value: "zero_added" },
];

function labelForDateFilter(val: string): string {
  switch (val) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "7d":
      return "Past 7 days";
    case "30d":
      return "Past 30 days";
    case "this_month":
      return "This month";
    case "last_month":
      return "Last month";
    default:
      if (val.includes("..")) {
        const [from, to] = val.split("..");
        if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
          const [fy, fm, fd] = from.split("-").map(Number);
          const [ty, tm, td] = to.split("-").map(Number);
          const fStr = new Date(fy, fm - 1, fd).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          });
          const tStr = new Date(ty, tm - 1, td).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          return `${fStr} – ${tStr}`;
        }
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        const [y, m, d] = val.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }
      return val;
  }
}

function labelForActivityFilter(val: string): string {
  switch (val) {
    case "added":
      return "With records added";
    case "failed_records":
      return "With failed records";
    case "flagged_records":
      return "With flagged records";
    case "zero_added":
      return "No records added";
    default:
      return val;
  }
}

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

  const {
    source: sourceFilter,
    status: statusFilter,
    date: dateFilter,
    trigger: triggerFilter,
    activity: activityFilter,
    q: search,
  } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("ingestion_runs")
    .select(
      "id, api_source, job_status, records_fetched, records_inserted, records_skipped, records_failed, records_flagged, started_at, completed_at, error_message, triggered_by",
    )
    .order("started_at", { ascending: false })
    .limit(WINDOW);

  // Charity Commission and Charity Commission Bulk Register are unified:
  // clicking either filters across both pipeline sources.
  if (sourceFilter === "charity_commission" || sourceFilter === "charity_commission_bulk") {
    query = query.in("api_source", CHARITY_COMMISSION_SOURCES);
  } else if (sourceFilter) {
    query = query.eq("api_source", sourceFilter);
  }

  if (statusFilter) query = query.eq("job_status", statusFilter);

  if (triggerFilter === "manual" || triggerFilter === "schedule") {
    query = query.eq("triggered_by", triggerFilter);
  }

  if (activityFilter === "added") {
    query = query.gt("records_inserted", 0);
  } else if (activityFilter === "failed_records") {
    query = query.gt("records_failed", 0);
  } else if (activityFilter === "flagged_records") {
    query = query.gt("records_flagged", 0);
  } else if (activityFilter === "zero_added") {
    query = query.eq("records_inserted", 0);
  }

  if (dateFilter) {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (dateFilter === "today") {
      query = query.gte("started_at", startOfToday.toISOString());
    } else if (dateFilter === "yesterday") {
      const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
      query = query
        .gte("started_at", startOfYesterday.toISOString())
        .lt("started_at", startOfToday.toISOString());
    } else if (dateFilter === "7d") {
      const past7d = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);
      query = query.gte("started_at", past7d.toISOString());
    } else if (dateFilter === "30d") {
      const past30d = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000);
      query = query.gte("started_at", past30d.toISOString());
    } else if (dateFilter === "this_month") {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      query = query.gte("started_at", startOfMonth.toISOString());
    } else if (dateFilter === "last_month") {
      const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      query = query
        .gte("started_at", startOfLastMonth.toISOString())
        .lt("started_at", startOfThisMonth.toISOString());
    } else if (dateFilter.includes("..")) {
      const [fromStr, toStr] = dateFilter.split("..");
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromStr) && /^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
        const [fy, fm, fd] = fromStr.split("-").map(Number);
        const [ty, tm, td] = toStr.split("-").map(Number);
        const dayStart = new Date(fy, fm - 1, fd);
        const dayEnd = new Date(ty, tm - 1, td + 1);
        query = query
          .gte("started_at", dayStart.toISOString())
          .lt("started_at", dayEnd.toISOString());
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
      const [y, m, d] = dateFilter.split("-").map(Number);
      const dayStart = new Date(y, m - 1, d);
      const dayEnd = new Date(y, m - 1, d + 1);
      query = query
        .gte("started_at", dayStart.toISOString())
        .lt("started_at", dayEnd.toISOString());
    }
  }

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

  const filtersActive = Boolean(
    sourceFilter || statusFilter || dateFilter || triggerFilter || activityFilter || search,
  );
  const recordsAdded = views.reduce(
    (total, view) => total + (view.counts.find((count) => count.label === "Added")?.value ?? 0),
    0,
  );
  const failures = views.filter((view) => view.status === "failed").length;

  // The sources that have actually run, so the filter offers something that
  // returns rows — plus whichever is filtered on, so its chip is still named
  // when the filter matches nothing.
  const rawSourceTokens = Array.from(
    new Set([...(runs ?? []).map((run) => run.api_source), ...(sourceFilter ? [sourceFilter] : [])]),
  );

  // If Charity Commission is among recent runs or filter, ensure both variants are
  // offered in the options so whichever one the user clicks, it filters by both.
  const hasCharityCommission = rawSourceTokens.some(
    (t) => t === "charity_commission" || t === "charity_commission_bulk",
  );
  const sourceTokens = Array.from(
    new Set([
      ...rawSourceTokens,
      ...(hasCharityCommission ? ["charity_commission", "charity_commission_bulk"] : []),
    ]),
  );

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <SearchRail
        className="max-w-6xl"
        stageClassName="space-y-10"
        heading={
          <DataImportsHeader current="/admin/import-status">
            <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
              Every data ingestion run, most recent first — what it fetched, what
              it added, and why it stopped if it did. Open a run for the full
              record counts.
            </p>
          </DataImportsHeader>
        }
        bar={
            <BrandSearchBar
              placeholder="Search the runs for"
              subjects={["sources", "outcomes", "dates", "triggers", "failures", "records"]}
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
                ...(dateFilter
                  ? [
                      {
                        category: "Filter by date",
                        label: labelForDateFilter(dateFilter),
                        value: dateFilter,
                      },
                    ]
                  : []),
                ...(triggerFilter
                  ? [
                      {
                        category: "Filter by trigger",
                        label: triggerFilter === "manual" ? "Manual import" : "Scheduled run",
                        value: triggerFilter,
                      },
                    ]
                  : []),
                ...(activityFilter
                  ? [
                      {
                        category: "Filter by activity",
                        label: labelForActivityFilter(activityFilter),
                        value: activityFilter,
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
                "Filter by date": DATE_OPTIONS,
                "Filter by trigger": TRIGGER_OPTIONS,
                "Filter by activity": ACTIVITY_OPTIONS,
              }}
            />
        }
      >
        {error ? (
          <Rise>
            <InlineAlert
              variant="page"
              message="Import history could not be loaded. This has been recorded — refresh and try again."
            />
          </Rise>
        ) : (
          <Group className="space-y-6">
            <Rise>
              <IngestionGuide />
            </Rise>

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
                <EmptyState
                  message={
                    filtersActive
                      ? "No import runs match this filter."
                      : "No import runs recorded yet. They appear here the first time an ingestion job runs."
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
