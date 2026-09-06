// Companies House imports.
//
// The criteria that decide what gets imported — Tier A/B/C legal forms and a
// SIC allowlist — used to be constants in a config file, applied inside live
// API queries. Nobody without a pull request could change them and nobody
// looking at the page could see what they cost.
//
// So the shape changed rather than the constants. The expensive half — reading
// ~2GB of the monthly Basic Company Data product — is a job that stages every
// mission-plausible company into a SQLite file shipped with the deployment.
// The selective half is this page: an ordinary query over that file, with a
// live count, so a criterion is something you set and immediately see the
// consequence of. See docs/companies-register-import.md for the full design.
//
// ── The layout ──
//
// Three things, in the order they are needed:
//
//   1. A rail under the tabs — how big the register is, which snapshot month
//      it was built from, and the button that refreshes it.
//   2. The run history, which is the landing view. Whether the last import
//      worked is the question people arrive with.
//   3. The composer, entered from that history rather than stacked under it.
//      `ImportConsole` owns which of the two is showing and keeps both mounted.
//
// The single-company lookup lives inside RecentRuns's header as a dialog: it needs
// neither a staged register nor a loaded history, and it answers a different
// question ("this exact company") than the composer does.
//
// The root element is a `div`, not a `main`: the admin layout's AppShell already
// renders the `main` this is slotted into.

import { redirect } from "next/navigation";

import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/error-logging";
import { ocrUnavailableReason } from "@/lib/cic-statement/ocr";
import {
  MAX_BACKFILL as MAX_CIC_BACKFILL,
  findCicTargets,
} from "@/lib/cic-statement/backfill";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { parseFilters } from "@/lib/companies-register/filters";
import {
  companiesRegisterMeta,
  sicValues,
} from "@/lib/companies-register/sqlite";
import { DataImportsHeader } from "../data-imports-header";
import { CompaniesFilterBuilder, type CompaniesPresetSummary } from "./filter-builder";
import { ImportConsole, NewImportButton } from "./import-console";
import { CompaniesRecentRuns, type CompaniesHouseRun } from "./recent-runs";
import { CompaniesRegisterRail } from "./register-rail";
import { CicStatementCard } from "./cic-statement-card";
import { CompaniesLookupDialog } from "./lookup-dialog";
import { CompaniesHouseGuide } from "./guide";

// The import runs inside a Server Action, not this page — but promotion of a
// large selection is the slowest thing on the route, so the ceiling is raised
// from the default. The snapshot itself is a CI job precisely because no
// serverless timeout would hold it.
export const maxDuration = 300;

const RUN_WINDOW = 8;

export default async function CompaniesHousePage() {
  // `client:edit`, not `user:manage`: the team decided everyone who works the
  // client list can shape and run imports. Viewers still cannot.
  const authorization = await getCurrentActor("client:edit");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const [runsResult, presetsResult] = await Promise.all([
    supabase
      .from("ingestion_runs")
      .select(
        "id, api_source, started_at, job_status, records_fetched, records_inserted, records_skipped, records_failed, run_stats",
      )
      .eq("api_source", "companies_house")
      .order("started_at", { ascending: false })
      .limit(RUN_WINDOW),
    admin
      ? admin
          .from("import_filter_presets")
          .select("id, name, description, filters")
          .eq("source", "companies_house")
          .order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  // The register is a file in the deployment, not a table — reading it is
  // synchronous and needs no await, and no Supabase round trip. An absent file
  // is the normal empty case (nothing staged yet), not an error.
  const meta = companiesRegisterMeta();
  let stagedSics: ReturnType<typeof sicValues> = [];
  try {
    stagedSics = sicValues();
  } catch (error) {
    await reportError(error, { operation: "admin.companies_house.sic_values" });
  }

  if (runsResult.error) {
    await reportError(runsResult.error, { operation: "admin.companies_house.list_runs" });
  }

  const runs = (runsResult.data ?? []) as CompaniesHouseRun[];

  const presets: CompaniesPresetSummary[] = ((presetsResult.data ?? []) as Array<{
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
  const sourceMonth = meta?.sourceMonth ?? null;
  const registerSize = meta?.companies ?? 0;

  // One clock for the page, read here rather than inside a component: a server
  // component's render must stay pure, and two reads could disagree.
  const now = new Date();
  const staleDays = snapshotDate
    ? Math.floor((now.getTime() - new Date(snapshotDate).getTime()) / 86_400_000)
    : null;

  // Tolerant, the same way every other read on this page is: the card is one
  // panel among several, and a failure here must not take the import console
  // with it. It also covers the window where the code has shipped and the
  // migration adding the two columns has not yet reached this environment —
  // the select fails, the card is simply absent, and the rest of the screen
  // works.
  let cicCoverage: Awaited<ReturnType<typeof findCicTargets>>["coverage"] | null = null;
  try {
    const supabaseForCic = await createClient();
    cicCoverage = (await findCicTargets(supabaseForCic)).coverage;
  } catch (error) {
    await reportError(error, { operation: "admin.companies_house.cic_coverage" });
  }

  // Both reasons the job cannot run, resolved server-side: the language model
  // is a filesystem check and the API key is server-only, so neither can be
  // answered from the client component that shows them.
  const cicUnavailable =
    ocrUnavailableReason() ??
    (process.env.COMPANIES_HOUSE_API_KEY?.trim()
      ? null
      : "The Companies House API key is not configured, so filings cannot be fetched.");

  const staged = registerSize > 0;
  // Read once here rather than at each render site: process.env is server-only,
  // and both branches below need the same answer.
  const lookupConfigured = Boolean(process.env.COMPANIES_HOUSE_API_KEY?.trim());

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto max-w-6xl space-y-8">
        <Rise>
          <DataImportsHeader current="/admin/companies-house">
            <CompaniesRegisterRail
              snapshotDate={snapshotDate}
              sourceMonth={sourceMonth}
              registerSize={registerSize}
              staleDays={staleDays}
              canRefresh={Boolean(process.env.GITHUB_REGISTER_TOKEN?.trim())}
            />
          </DataImportsHeader>
        </Rise>

        <Group>
          <Rise>
            <ImportConsole
              home={
                <>
                  {runsResult.error ? (
                    <>
                      <InlineAlert
                        variant="page"
                        message="Import history could not be loaded. This has been recorded — refresh and try again."
                      />
                      <div className="px-1">
                        <CompaniesLookupDialog configured={lookupConfigured} />
                      </div>
                    </>
                  ) : (
                    <CompaniesRecentRuns
                      runs={runs}
                      action={staged ? <NewImportButton /> : undefined}
                      secondaryAction={<CompaniesLookupDialog configured={lookupConfigured} />}
                    />
                  )}

                  {!staged && (
                    <InlineAlert
                      variant="page"
                      message="The register has not been loaded yet, so there is nothing to import from. Refresh it from the link above the history."
                    />
                  )}

                  {cicCoverage && cicCoverage.companies > 0 && (
                    <CicStatementCard
                      companies={cicCoverage.companies}
                      checked={cicCoverage.checked}
                      withStatement={cicCoverage.withStatement}
                      pending={cicCoverage.pending}
                      maxBatchSize={MAX_CIC_BACKFILL}
                      unavailableReason={cicUnavailable}
                    />
                  )}

                  <CompaniesHouseGuide />
                </>
              }
              composer={
                <CompaniesFilterBuilder
                  presets={presets}
                  sicValues={stagedSics}
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
