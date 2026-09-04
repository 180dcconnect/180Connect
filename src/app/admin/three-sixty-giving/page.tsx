import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { GroupTabs } from "@/components/ui/group-tabs";
import { DATA_IMPORTS_TABS } from "../import-group";
import { BackfillCard } from "./backfill-card";
import { BACKFILL_BATCH_SIZE, REFETCH_AFTER_DAYS, cutoffIso } from "@/lib/ingestion/three-sixty-giving-backfill";

// Resolved: this page used to host a bulk walk that made one request per known
// identifier at ~600ms apart, which exceeded any serverless timeout as soon as
// there were a few hundred identifiers — the TODO that used to sit here.
//
// It is a background job now (src/lib/ingestion/three-sixty-giving-backfill.ts),
// draining a bounded slice per invocation. The only action left on this page
// runs one such slice, which is sized to fit comfortably inside the ceiling.
export const maxDuration = 300;

type IngestionRun = {
  id: string;
  started_at: string;
  completed_at: string | null;
  job_status: "running" | "completed" | "failed" | "partial";
  records_fetched: number;
  records_inserted: number;
  records_skipped: number;
  records_failed: number;
};

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
      "id, started_at, completed_at, job_status, records_fetched, records_inserted, records_skipped, records_failed",
    )
    .eq("api_source", "360giving")
    .order("started_at", { ascending: false })
    .limit(10);

  if (error) {
    await reportError(error, { operation: "admin.three_sixty_giving.list_runs" });
  }

  const runs = (data ?? []) as IngestionRun[];

  // Coverage, for the progress card. Counted rather than derived from the runs
  // above: a run says how many records it fetched, which is a different question
  // from how much of the client list has been asked about at all.
  const cutoff = cutoffIso(new Date(), REFETCH_AFTER_DAYS);
  const [totalResult, dueResult, oldestResult] = await Promise.all([
    supabase.from("organisations").select("id", { count: "exact", head: true }),
    supabase
      .from("organisations")
      .select("id", { count: "exact", head: true })
      .or(`grants_fetched_at.is.null,grants_fetched_at.lt.${JSON.stringify(cutoff)}`),
    supabase
      .from("organisations")
      .select("grants_fetched_at")
      .not("grants_fetched_at", "is", null)
      .lt("grants_fetched_at", cutoff)
      .order("grants_fetched_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (totalResult.error || dueResult.error) {
    await reportError(totalResult.error ?? dueResult.error, {
      operation: "admin.three_sixty_giving.coverage",
    });
  }

  const totalCount = totalResult.count ?? 0;
  const checkedCount = Math.max(totalCount - (dueResult.count ?? 0), 0);
  const oldestPending =
    (oldestResult.data as { grants_fetched_at: string } | null)?.grants_fetched_at ?? null;

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">360Giving import</h1>
            <p className="mt-3 max-w-2xl text-sm text-foreground/65">
              Bring grant and funding history into charity records already in
              the pipeline, as an input to partnership prioritisation.
              api.threesixtygiving.org needs no API key — this always runs.
            </p>
          </div>
          <Link className="text-sm font-bold text-brand hover:underline" href="/admin">
            Back to admin
          </Link>
        </div>
        {/* Group navigation: the four importer pages read as one section. */}
        <GroupTabs className="mt-6" tabs={DATA_IMPORTS_TABS} current="/admin/three-sixty-giving" />

        <BackfillCard
          checked={checkedCount}
          total={totalCount}
          batchSize={BACKFILL_BATCH_SIZE}
          oldestPending={oldestPending}
        />

        <div className="mt-8">
          <h2 className="text-lg font-bold">Recent imports</h2>
          {error ? (
            <div className="mt-3">
              <InlineAlert
                variant="page"
                message="Import history could not be loaded. Please refresh and try again."
              />
            </div>
          ) : runs.length === 0 ? (
            <p className="mt-3 text-sm text-foreground/65">No 360Giving imports have run yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-black/10 text-foreground/60">
                  <tr>
                    <th className="p-3">Started</th><th className="p-3">Status</th>
                    <th className="p-3">Fetched</th><th className="p-3">Written</th>
                    <th className="p-3">Skipped</th><th className="p-3">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr className="border-b border-black/5" key={run.id}>
                      <td className="p-3">{new Date(run.started_at).toLocaleString("en-GB")}</td>
                      <td className="p-3 capitalize">{run.job_status}</td>
                      <td className="p-3">{run.records_fetched}</td>
                      <td className="p-3">{run.records_inserted}</td>
                      <td className="p-3">{run.records_skipped}</td>
                      <td className="p-3">{run.records_failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
