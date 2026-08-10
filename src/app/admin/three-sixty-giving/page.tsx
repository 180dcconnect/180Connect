import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { ThreeSixtyGivingImportForm } from "./import-form";
import { ThreeSixtyGivingLookupForm } from "./lookup-form";

// TODO: same unresolved risk flagged on Charity Commission's admin page
// (src/app/admin/charity-commission/page.tsx) — worse here, since the bulk
// walk makes one request per known charity/company identifier at ~600ms
// apart (see threesixtygiving.ts's REQUEST_INTERVAL_MS). A few hundred
// identifiers already exceeds this timeout. Not solved here; worth deciding
// whether this needs to become a background job rather than a synchronous
// button once the identifier count makes that bite.
export const maxDuration = 60;

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

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-brand">Data ingestion</p>
            <h1 className="mt-2 text-3xl font-bold">360Giving import</h1>
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

        <ThreeSixtyGivingImportForm />
        <ThreeSixtyGivingLookupForm />

        <div className="mt-8">
          <h2 className="text-lg font-bold">Recent imports</h2>
          {error ? (
            <p className="mt-3 rounded-lg bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">
              Import history could not be loaded. Please refresh and try again.
            </p>
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
