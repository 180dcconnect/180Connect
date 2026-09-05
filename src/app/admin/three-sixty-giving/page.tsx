import { redirect } from "next/navigation";
import Image from "next/image";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { GroupTabs } from "@/components/ui/group-tabs";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import type { IngestionRunRow } from "../import-status/run-format";
import { DATA_IMPORTS_TABS } from "../import-group";
import { BackfillCard } from "./backfill-card";
import { GrantsGuide } from "./guide";
import { ThreeSixtyRecentRuns } from "./recent-runs";
import { BACKFILL_BATCH_SIZE, MANUAL_BACKFILL_BATCH_SIZE, MANUAL_BACKFILL_MAX, REFETCH_AFTER_DAYS, cutoffIso } from "@/lib/ingestion/three-sixty-giving-backfill";

// The import runs inside a Server Action, not this page — but draining a
// slice is the slowest thing on the route, so the ceiling is raised from the
// default. Server Actions inherit it from the page.
// The root element is a `div`, not a `main`: the admin layout's AppShell already
// renders the `main` this is slotted into.
export const maxDuration = 300;

export default async function ThreeSixtyGivingPage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select(
      "id, api_source, started_at, completed_at, job_status, records_fetched, records_inserted, records_skipped, records_failed, records_flagged, error_message",
    )
    .eq("api_source", "360giving")
    .order("started_at", { ascending: false })
    .limit(10);

  if (error) {
    await reportError(error, { operation: "admin.three_sixty_giving.list_runs" });
  }

  const runs = (data ?? []) as IngestionRunRow[];

  // Coverage, for the progress card. Counted rather than derived from the runs
  // above: a run says how many records it fetched, which is a different question
  // from how much of the client list has been asked about at all.
  //
  // The population matches the dashboard's Total Organisations: suppressed
  // (opted-out) clients are out of the outreach pool, so the queue neither
  // counts nor checks them (see three-sixty-giving-backfill.ts). Reads stay
  // light (two columns) and paginate past PostgREST's 1000-row cap, the same
  // way the dashboard loads its rows.
  const cutoff = cutoffIso(new Date(), REFETCH_AFTER_DAYS);

  const suppressedIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error: suppressedError } = await supabase
      .from("suppressions")
      .select("organisation_id")
      .eq("status", "active")
      .order("organisation_id", { ascending: true })
      .range(from, from + 999);
    if (suppressedError) {
      await reportError(suppressedError, {
        operation: "admin.three_sixty_giving.coverage",
      });
      break;
    }
    for (const row of (data ?? []) as Array<{ organisation_id: string }>) {
      suppressedIds.add(row.organisation_id);
    }
    if (!data || data.length < 1000) break;
  }

  const fetchStates: Array<{ id: string; grants_fetched_at: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: statesError } = await supabase
      .from("organisations")
      .select("id, grants_fetched_at")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (statesError) {
      await reportError(statesError, {
        operation: "admin.three_sixty_giving.coverage",
      });
      break;
    }
    fetchStates.push(...((data ?? []) as typeof fetchStates));
    if (!data || data.length < 1000) break;
  }

  const liveStates = fetchStates.filter((row) => !suppressedIds.has(row.id));
  const dueCount = liveStates.filter(
    (row) => row.grants_fetched_at === null || row.grants_fetched_at < cutoff,
  ).length;

  const totalCount = liveStates.length;
  const checkedCount = Math.max(totalCount - dueCount, 0);
  let oldestPending: string | null = null;
  for (const row of liveStates) {
    const seen = row.grants_fetched_at;
    if (seen === null || seen >= cutoff) continue;
    if (oldestPending === null || seen < oldestPending) oldestPending = seen;
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto max-w-5xl space-y-8">
        <Rise>
          <div className="flex items-center gap-4">
            <a
              href="https://360giving.org"
              target="_blank"
              rel="noreferrer"
              aria-label="360Giving website (opens in a new tab)"
              className="shrink-0 transition-opacity hover:opacity-80"
            >
              <Image
                src="/sources/360giving.png"
                alt=""
                width={140}
                height={77}
                className="h-10 w-auto"
              />
            </a>
            <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
              360Giving
            </h1>
          </div>
          <GroupTabs
            className="mt-4"
            tabs={DATA_IMPORTS_TABS}
            current="/admin/three-sixty-giving"
          />
          <p className="mt-3 max-w-xl text-sm leading-[1.7] text-dim">
            See which clients have won grants before, so you can spot
            experienced fundraisers when choosing partners. Covers registered
            charities and companies — other clients are skipped automatically.
          </p>
        </Rise>

        <Group className="space-y-6">
          <Rise>
            <BackfillCard
              checked={checkedCount}
              total={totalCount}
              defaultBatchSize={MANUAL_BACKFILL_BATCH_SIZE}
              maxBatchSize={MANUAL_BACKFILL_MAX}
              cronBatchSize={BACKFILL_BATCH_SIZE}
              oldestPending={oldestPending}
            />
          </Rise>

          <Rise>
            {error ? (
              <InlineAlert
                variant="page"
                message="Import history could not be loaded. This has been recorded — refresh and try again."
              />
            ) : (
              <ThreeSixtyRecentRuns runs={runs} />
            )}
          </Rise>

          <Rise>
            <GrantsGuide />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
