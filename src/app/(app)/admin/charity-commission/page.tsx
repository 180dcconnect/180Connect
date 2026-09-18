// Charity Commission imports.
//
// The criteria that decide what gets imported — an income floor, a set of
// sectors, a list of place names — used to be constants in a config file,
// applied inside a streaming download. Nobody without a pull request could
// change them and nobody looking at the page could see what they cost. They
// cost a great deal: the £100k floor alone excluded 3,229 of the 4,340
// charities local to the branch.
//
// So the shape changed rather than the constants. The expensive half — reading
// ~1.8GB of daily extracts — is a job that filters nothing and stages the whole
// register of England and Wales. The selective half is this page: an ordinary
// query over that register, with a live count, so a criterion is something you
// set and immediately see the consequence of.
//
// ── The layout ──
//
// Three things, in the order they are needed:
//
//   1. A rail under the tabs — how big the register is, when it was last
//      checked, and the button that refreshes it. This was a card explaining
//      that the register is a file shipped with the deployment; see
//      register-rail.tsx for why that is now one line.
//   2. The run history, which is the landing view. Whether the last import
//      worked is the question people arrive with.
//   3. The composer, entered from that history rather than stacked under it.
//      `ImportConsole` owns which of the two is showing and keeps both mounted.
//
// The root element is a `div`, not a `main`: the admin layout's AppShell already
// renders the `main` this is slotted into.

import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";

import { getViewingActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/error-logging";
import { hasPermission } from "@/lib/auth/permissions";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { parseFilters } from "@/lib/charity-register/filters";
import { loadCharityIdentifiers } from "@/lib/charity-register/coverage-reads";
import {
  coverageRefreshShouldStart,
  coverageSnapshotsNeedRefresh,
  hasAnyCalculatedCoverage,
  readCoverageSnapshots,
  refreshCharityCoverageSnapshots,
} from "@/lib/charity-register/coverage-snapshots";
import { labelValues, registerMeta } from "@/lib/charity-register/sqlite";
import { LABEL_KIND } from "@/lib/charity-register/sqlite-query";
import { DataImportsHeader } from "../data-imports-header";
import {
  AnnualReturnCoverageCard,
  CompanyNumberCoverageCard,
  CoverageCardFallback,
  GeographicReachCoverageCard,
  RegisterProfileCoverageCard,
  SnapshotCoverageCards,
} from "./coverage-cards";
import { CoverageRefreshPoller } from "./coverage-refresh-poller";
import { CharityLookupDialog } from "./lookup-dialog";
import { FilterBuilder, type PresetSummary } from "./filter-builder";
import { ImportConsole, NewImportButton } from "./import-console";
import { PipelinesGuide } from "./pipelines-guide";
import { RecentRuns } from "./recent-runs";
import { RegisterRail } from "./register-rail";
import type { CharityCommissionRun } from "./bulk-funnel";

// The import runs inside a Server Action, not this page — but promotion of a
// large selection is the slowest thing on the route, so the ceiling is raised
// from the default. The snapshot itself is a CLI job precisely because no
// serverless timeout would hold it.
export const maxDuration = 300;

const RUN_WINDOW = 8;

export default async function CharityCommissionPage() {
  // `client:edit`, not `user:manage`: the team decided everyone who works the
  // client list can shape and run imports. Viewers still cannot.
  const authorization = await getViewingActor("client:edit");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  // Leadership reads this screen and runs nothing on it. `client:edit` is the
  // exact permission every write behind the run history asks for — the import,
  // the single-charity lookup, the Part B backfill and the register profile
  // backfill — and `platform-settings:manage` is what the register refresh asks
  // for. Asking the same questions here keeps a button a viewer cannot use off
  // the page, rather than letting them press it and be refused.
  const canImport = hasPermission(authorization.actor.role, "client:edit");
  const canRefreshRegister =
    canImport && hasPermission(authorization.actor.role, "platform-settings:manage");

  const supabase = await createClient();
  const admin = createAdminClient();

  const [runsResult, presetsResult, coverageRead] = await Promise.all([
    supabase
      .from("ingestion_runs")
      .select(
        "id, api_source, started_at, job_status, records_fetched, records_inserted, records_skipped, records_failed, run_stats",
      )
      .in("api_source", ["charity_commission", "charity_commission_bulk"])
      .order("started_at", { ascending: false })
      .limit(RUN_WINDOW),
    admin
      ? admin
          .from("import_filter_presets")
          .select("id, name, description, filters")
          .eq("source", "charity_commission")
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    readCoverageSnapshots(supabase),
  ]);

  // The register is a file in the deployment, not a table — reading it is
  // synchronous and needs no await, and no Supabase round trip.
  const meta = registerMeta();
  const localAuthorities = labelValues(LABEL_KIND.localAuthority);

  if (runsResult.error) {
    await reportError(runsResult.error, { operation: "admin.charity_commission.list_runs" });
  }
  if (!coverageRead.available && !coverageRead.migrationMissing) {
    await reportError(coverageRead.error, {
      operation: "admin.charity_commission.read_coverage_snapshots",
    });
  }

  const runs = (runsResult.data ?? []) as CharityCommissionRun[];

  const presets: PresetSummary[] = ((presetsResult.data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    filters: unknown;
  }>).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    filters: parseFilters(row.filters),
  }));

  const snapshotDate = meta?.builtOn ?? null;
  const registerSize = meta?.charities ?? 0;

  // One clock for the page, read here rather than inside a component: a server
  // component's render must stay pure, and two reads could disagree. `new Date()`
  // rather than `Date.now()` — the same shape /admin/import-status uses, and the
  // one the React Compiler's purity rule accepts.
  const now = new Date();
  const staleDays = snapshotDate
    ? Math.floor((now.getTime() - new Date(snapshotDate).getTime()) / 86_400_000)
    : null;

  const staged = registerSize > 0;
  // Read once here rather than at each render site: process.env is server-only,
  // and both branches below need the same answer.
  const lookupConfigured = Boolean(process.env.CHARITY_COMMISSION_API_KEY?.trim());

  const coverageNeedsRefresh =
    coverageRead.available && snapshotDate
      ? coverageSnapshotsNeedRefresh(coverageRead.snapshots, snapshotDate)
      : false;
  const coverageRefreshCanStart =
    coverageRead.available && snapshotDate
      ? coverageRefreshShouldStart(coverageRead.snapshots, snapshotDate, now.getTime())
      : false;
  if (coverageRefreshCanStart && snapshotDate) {
    // All request-bound values are captured before `after`: Server Components
    // may not read request APIs inside this callback. Database leases make this
    // safe when several visitors schedule the same stale refresh together.
    after(() => refreshCharityCoverageSnapshots(snapshotDate));
  }

  // Mixed-version fallback only. A deployment can briefly serve this code
  // before its additive migration reaches PostgREST; keep the old streamed path
  // in that window instead of hiding the cards or failing the whole page.
  const charityIdentifiers =
    !coverageRead.available && coverageRead.migrationMissing && admin
      ? loadCharityIdentifiers(admin)
      : null;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto max-w-6xl space-y-8">
        <Rise>
          <DataImportsHeader current="/admin/charity-commission">
            <RegisterRail
              snapshotDate={snapshotDate}
              registerSize={registerSize}
              staleDays={staleDays}
              canRefresh={
                canRefreshRegister && Boolean(process.env.GITHUB_REGISTER_TOKEN?.trim())
              }
            />
          </DataImportsHeader>
        </Rise>

        <Group>
          <Rise>
            <ImportConsole
              home={
                <>
                  {/* The screen's other starting point, beside the primary one
                      rather than below the history. It used to sit under the run
                      list, which on a page with real history put the one action
                      that needs neither a staged register nor a loaded history
                      below the fold — and directly under an alert saying there
                      was nothing to import from. Kept a quiet text link against
                      the solid button, so the weighting still says which of the
                      two is the common job.

                      Rendered in both branches on purpose: a failed history read
                      says nothing about whether a lookup would work, and losing
                      the link there would take the one thing still available on a
                      broken page. */}
                  {runsResult.error ? (
                    <>
                      <InlineAlert
                        variant="page"
                        message="Import history could not be loaded. This has been recorded — refresh and try again."
                      />
                      {canImport && (
                        <div className="px-1">
                          <CharityLookupDialog configured={lookupConfigured} />
                        </div>
                      )}
                    </>
                  ) : (
                    <RecentRuns
                      runs={runs}
                      nowIso={now.toISOString()}
                      action={staged && canImport ? <NewImportButton /> : undefined}
                      secondaryAction={
                        canImport ? (
                          <CharityLookupDialog configured={lookupConfigured} />
                        ) : undefined
                      }
                    />
                  )}

                  {!staged && (
                    <InlineAlert
                      variant="page"
                      message={
                        canImport
                          ? "The register has not been loaded yet, so there is nothing to import from. Refresh it from the link above the history."
                          : "The register has not been loaded yet, so there is nothing to import from."
                      }
                    />
                  )}

                  {coverageRead.available ? (
                    <>
                      {staged && (
                        <SnapshotCoverageCards
                          snapshots={coverageRead.snapshots}
                          readOnly={!canImport}
                        />
                      )}
                      {!hasAnyCalculatedCoverage(coverageRead.snapshots) && staged && (
                        <InlineAlert
                          variant="page"
                          message="Coverage figures are being prepared. The rest of this page is ready to use, and the figures will appear here automatically."
                        />
                      )}
                      {coverageNeedsRefresh && <CoverageRefreshPoller />}
                    </>
                  ) : admin && charityIdentifiers ? (
                    <>
                      <Suspense fallback={<CoverageCardFallback />}>
                        <AnnualReturnCoverageCard
                          admin={admin}
                          identifiers={charityIdentifiers}
                          readOnly={!canImport}
                        />
                      </Suspense>
                      <Suspense fallback={<CoverageCardFallback />}>
                        <RegisterProfileCoverageCard
                          admin={admin}
                          identifiers={charityIdentifiers}
                          readOnly={!canImport}
                        />
                      </Suspense>
                      <Suspense fallback={<CoverageCardFallback />}>
                        <GeographicReachCoverageCard
                          admin={admin}
                          identifiers={charityIdentifiers}
                          readOnly={!canImport}
                        />
                      </Suspense>
                      <Suspense fallback={<CoverageCardFallback />}>
                        <CompanyNumberCoverageCard
                          admin={admin}
                          identifiers={charityIdentifiers}
                          readOnly={!canImport}
                        />
                      </Suspense>
                    </>
                  ) : null}

                  <PipelinesGuide />
                </>
              }
              composer={
                <FilterBuilder
                  presets={presets}
                  localAuthorities={localAuthorities}
                  registerSize={registerSize}
                />
              }
            />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
