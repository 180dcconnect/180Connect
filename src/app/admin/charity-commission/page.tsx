// Charity Commission imports.
//
// Rebuilt onto the design system (docs/design-system.md §Inside the app), the
// same language as /admin/import-status: bone ground, white cards floating on
// it, a display heading against 11px labels, and a staged blur-up entrance from
// the shared brand variants.
//
// Three things were wrong with the page this replaces, beyond its palette:
//
//   1. It showed the weakest pipeline and hid the strongest. The runs table
//      filtered `api_source = 'charity_commission'`, so bulk register runs — the
//      ones that delivered every charity with filed accounts — were invisible on
//      the Charity Commission page. Both are shown now.
//   2. It had no way to say what the import accepts. "Why isn't charity X in the
//      list" could only be settled by reading charity-commission-bulk-config.ts.
//      ImportCriteria renders that config, and the last run's funnel shows what
//      it did to the register.
//   3. Its "Run import" button ran the fixed date-range backfill, whose own TODO
//      said a wide range could exceed the serverless timeout. The bulk register
//      extract supersedes it and does the job properly, so both the button and
//      the adapter behind it are gone.
//
// The "Back to admin" and "Review queue" links are gone too: GroupTabs is this
// section's navigation, and the review queue is a different job on a different
// day.
//
// The root element is a `div`, not a `main`: the admin layout's AppShell already
// renders the `main` this is slotted into.

import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { GroupTabs } from "@/components/ui/group-tabs";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { DATA_IMPORTS_TABS } from "../import-group";
import { CharityCommissionImportAutoButton } from "./import-auto-button";
import { CharityCommissionLookupForm } from "./lookup-form";
import { BulkImportCard, type LastBulkRun } from "./bulk-import-card";
import { ImportCriteria } from "./import-criteria";
import { PipelinesGuide } from "./pipelines-guide";
import { RecentRuns } from "./recent-runs";
import type { CharityCommissionRun } from "./bulk-funnel";

// The discovery trigger is a weekly delta — a handful of search calls and one
// batched details call — which finishes well inside this. The bulk register
// import is deliberately not reachable from here at all: 508MB of charities and
// 1.26GB of annual returns is not work for a function with a 300s ceiling, so
// BulkImportCard hands over the command instead of pretending to be a button.
export const maxDuration = 60;

/** Both Charity Commission pipelines, newest first. */
const RUN_WINDOW = 8;

export default async function CharityCommissionPage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select(
      "id, api_source, started_at, job_status, records_fetched, records_inserted, records_skipped, records_failed, run_stats",
    )
    .in("api_source", ["charity_commission", "charity_commission_bulk"])
    .order("started_at", { ascending: false })
    .limit(RUN_WINDOW);

  if (error) {
    await reportError(error, { operation: "admin.charity_commission.list_runs" });
  }

  const runs = (data ?? []) as CharityCommissionRun[];
  const configured = Boolean(process.env.CHARITY_COMMISSION_API_KEY?.trim());

  // The most recent bulk run within the window. A page where bulk has not run in
  // the last eight runs shows no funnel rather than a stale one dressed as
  // current — the full history is one link away.
  const latestBulk = runs.find((run) => run.api_source === "charity_commission_bulk");
  const lastBulkRun: LastBulkRun = latestBulk
    ? {
        startedAt: latestBulk.started_at,
        status: latestBulk.job_status,
        recordsInserted: latestBulk.records_inserted,
        runStats: latestBulk.run_stats,
      }
    : null;

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
            Two imports read the same register. One catches charities as they
            register; the other brings in established charities with their filed
            accounts.
          </p>
        </Rise>

        {!configured && (
          <Rise>
            <InlineAlert
              variant="page"
              message="Charity Commission API access is not configured. Add the server-side API key before running an import."
            />
          </Rise>
        )}

        <Group className="space-y-6">
          <Rise>
            <PipelinesGuide />
          </Rise>

          <Rise>
            <BulkImportCard lastRun={lastBulkRun} />
          </Rise>

          <Rise>
            <ImportCriteria />
          </Rise>

          <Rise>
            <CharityCommissionImportAutoButton configured={configured} />
          </Rise>

          <Rise>
            <CharityCommissionLookupForm configured={configured} />
          </Rise>

          <Rise>
            {error ? (
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
