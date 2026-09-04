// Charity Commission imports.
//
// This screen used to show two buttons and a table of counts. The criteria that
// decided what those buttons did — an income floor, five accepted sectors, four
// place names — lived in charity-commission-bulk-config.ts and were applied
// inside a streaming download, so nobody without a pull request could change
// them and nobody looking at the page could see what they cost.
//
// Measured against the 2026-09-03 extract, they cost a great deal: the £100k
// floor alone excluded 3,229 of the 4,340 charities local to the branch, the
// five-sector list left out arts, heritage, environment and religion entirely,
// and the locality clause compared "sheffield" against a register that spells it
// "Sheffield City", so it never matched at all.
//
// So the shape changed rather than the constants. The expensive half — reading
// ~1.8GB of daily extracts — is now a snapshot job that filters nothing and
// stages the whole register of England and Wales. The selective half is this
// page: an ordinary query over that table, with a live count, so a criterion is
// something you set and immediately see the consequence of.
//
// The root element is a `div`, not a `main`: the admin layout's AppShell already
// renders the `main` this is slotted into.

import { redirect } from "next/navigation";

import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { GroupTabs } from "@/components/ui/group-tabs";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { parseFilters } from "@/lib/charity-register/filters";
import { labelValues, registerMeta } from "@/lib/charity-register/sqlite";
import { LABEL_KIND } from "@/lib/charity-register/sqlite-query";
import { DATA_IMPORTS_TABS } from "../import-group";
import { CharityCommissionLookupForm } from "./lookup-form";
import { FilterBuilder, type PresetSummary } from "./filter-builder";
import { PipelinesGuide } from "./pipelines-guide";
import { RecentRuns } from "./recent-runs";
import { SnapshotCard } from "./snapshot-card";
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
  ]);

  // The register is a file in the deployment, not a table — reading it is
  // synchronous and needs no await, and no Supabase round trip.
  const meta = registerMeta();
  const localAuthorities = labelValues(LABEL_KIND.localAuthority);

  if (runsResult.error) {
    await reportError(runsResult.error, { operation: "admin.charity_commission.list_runs" });
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

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto max-w-5xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Charity Commission
          </h1>
          <GroupTabs
            className="mt-4"
            tabs={DATA_IMPORTS_TABS}
            current="/admin/charity-commission"
          />
          <p className="mt-3 max-w-xl text-sm leading-[1.7] text-foreground/65">
            The whole register of England and Wales is staged here, unfiltered.
            Choose which charities you want and import them — nothing is decided
            in advance.
          </p>
        </Rise>

        <Group className="space-y-6">
          <Rise>
            <PipelinesGuide />
          </Rise>

          <Rise>
            <SnapshotCard
              snapshotDate={snapshotDate}
              registerSize={registerSize}
              staleDays={staleDays}
              canRefresh={Boolean(process.env.GITHUB_REGISTER_TOKEN?.trim())}
            />
          </Rise>

          {staged ? (
            <Rise>
              <FilterBuilder
                presets={presets}
                localAuthorities={localAuthorities}
                snapshotDate={snapshotDate}
                registerSize={registerSize}
              />
            </Rise>
          ) : (
            <Rise>
              <InlineAlert
                variant="page"
                message="The register has not been staged yet. Run the snapshot job before importing — the card above has the command."
              />
            </Rise>
          )}

          <Rise>
            <CharityCommissionLookupForm configured={Boolean(process.env.CHARITY_COMMISSION_API_KEY?.trim())} />
          </Rise>

          <Rise>
            {runsResult.error ? (
              <InlineAlert
                variant="page"
                message="Import history could not be loaded. This has been recorded — refresh and try again."
              />
            ) : (
              <RecentRuns runs={runs} />
            )}
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
