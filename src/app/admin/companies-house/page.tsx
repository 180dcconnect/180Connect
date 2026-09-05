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
// The single-company lookup sits below the console as its own card: it needs
// neither a staged register nor a loaded history, and it answers a different
// question ("this exact company") than the composer does.
//
// The root element is a `div`, not a `main`: the admin layout's AppShell already
// renders the `main` this is slotted into.

import { redirect } from "next/navigation";
import Image from "next/image";

import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { GroupTabs } from "@/components/ui/group-tabs";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { parseFilters } from "@/lib/companies-register/filters";
import {
  companiesRegisterMeta,
  sicValues,
} from "@/lib/companies-register/sqlite";
import { DATA_IMPORTS_TABS } from "../import-group";
import { CompaniesFilterBuilder, type CompaniesPresetSummary } from "./filter-builder";
import { ImportConsole, NewImportButton } from "./import-console";
import { CompaniesRecentRuns, type CompaniesHouseRun } from "./recent-runs";
import { CompaniesRegisterRail } from "./register-rail";
import { CompaniesHouseImportForm } from "./import-form";
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

  const staged = registerSize > 0;
  // Read once here rather than at each render site: process.env is server-only,
  // and both branches below need the same answer.
  const lookupConfigured = Boolean(process.env.COMPANIES_HOUSE_API_KEY?.trim());

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto max-w-5xl space-y-8">
        <Rise>
          <div className="flex items-center gap-4">
            <a
              href="https://find-and-update.company-information.service.gov.uk"
              target="_blank"
              rel="noreferrer"
              aria-label="Companies House register (opens in a new tab)"
              className="shrink-0 transition-opacity hover:opacity-80"
            >
              <Image
                src="/sources/companies-house.png"
                alt=""
                width={112}
                height={112}
                className="h-20 w-auto sm:h-24 md:h-28"
              />
            </a>
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              Companies House
            </h1>
          </div>
          <GroupTabs
            className="mt-4"
            tabs={DATA_IMPORTS_TABS}
            current="/admin/companies-house"
          />
          <CompaniesRegisterRail
            snapshotDate={snapshotDate}
            sourceMonth={sourceMonth}
            registerSize={registerSize}
            staleDays={staleDays}
            canRefresh={Boolean(process.env.GITHUB_REGISTER_TOKEN?.trim())}
          />
        </Rise>

        <Group>
          <Rise>
            <ImportConsole
              home={
                <>
                  {runsResult.error ? (
                    <InlineAlert
                      variant="page"
                      message="Import history could not be loaded. This has been recorded — refresh and try again."
                    />
                  ) : (
                    <CompaniesRecentRuns
                      runs={runs}
                      action={staged ? <NewImportButton /> : undefined}
                    />
                  )}

                  {!staged && (
                    <InlineAlert
                      variant="page"
                      message="The register has not been loaded yet, so there is nothing to import from. Refresh it from the link above the history."
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

          <Rise>
            <CompaniesHouseImportForm configured={lookupConfigured} />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
