import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { CharityCommissionImportForm } from "./import-form";
import { CharityCommissionImportAutoButton } from "./import-auto-button";
import { CharityCommissionLookupForm } from "./lookup-form";

// TODO: Companies House's admin trigger uses maxDuration = 60 (a single
// company lookup finishes well within that). Charity Commission's fetch() is
// a bulk date-range import — even the narrow one-month test range took
// longer than a single lookup, and a wider range could exceed a 60s
// serverless timeout entirely. This page inherits that same risk without
// solving it: triggering a wide date range through this button may time out
// mid-import. Worth deciding with the team whether the admin trigger should
// only run a small/incremental range (e.g. "since last successful run"), or
// whether this needs to become a background job instead of a synchronous
// server action. Not resolved here.
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
      "id, started_at, completed_at, job_status, records_fetched, records_inserted, records_skipped, records_failed",
    )
    .eq("api_source", "charity_commission")
    .order("started_at", { ascending: false })
    .limit(10);

  if (error) {
    await reportError(error, { operation: "admin.charity_commission.list_runs" });
  }

  const runs = (data ?? []) as IngestionRun[];
  const configured = Boolean(process.env.CHARITY_COMMISSION_API_KEY?.trim());

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-brand">Data ingestion</p>
            <h1 className="mt-2 text-3xl font-bold">Charity Commission import</h1>
            <p className="mt-3 max-w-2xl text-sm text-foreground/65">
              Bring UK charity registration and contact data into the
              validation and matching pipeline.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link className="text-sm font-bold text-brand hover:underline" href="/admin/review">
              Review queue
            </Link>
            <Link className="text-sm font-bold text-brand hover:underline" href="/admin">
              Back to admin
            </Link>
          </div>
        </div>

        <div className="mt-8">
          <CharityCommissionImportAutoButton configured={configured} />
        </div>
        <CharityCommissionImportForm configured={configured} />
        <CharityCommissionLookupForm configured={configured} />

        <div className="mt-8">
          <h2 className="text-lg font-bold">Recent imports</h2>
          {error ? (
            <p className="mt-3 rounded-lg bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">
              Import history could not be loaded. Please refresh and try again.
            </p>
          ) : runs.length === 0 ? (
            <p className="mt-3 text-sm text-foreground/65">No Charity Commission imports have run yet.</p>
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