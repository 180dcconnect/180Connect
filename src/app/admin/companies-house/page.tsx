import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { CompaniesHouseImportForm } from "./import-form";
import { CompaniesHouseImportAutoButton } from "./import-auto-button";

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

export default async function CompaniesHousePage() {
  const authorization = await getCurrentActor("user:manage");
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("id, started_at, completed_at, job_status, records_fetched, records_inserted, records_skipped, records_failed")
    .eq("api_source", "companies_house")
    .order("started_at", { ascending: false })
    .limit(10);

  if (error) {
    await reportError(error, { operation: "admin.companies_house.list_runs" });
  }

  const runs = (data ?? []) as IngestionRun[];
  const configured = Boolean(process.env.COMPANIES_HOUSE_API_KEY?.trim());

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-brand">Data ingestion</p>
            <h1 className="mt-2 text-3xl font-bold">Companies House import</h1>
            <p className="mt-3 max-w-2xl text-sm text-foreground/65">
              Bring UK company registration data into the validation and matching pipeline.
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
          <CompaniesHouseImportAutoButton configured={configured} />
        </div>
        <CompaniesHouseImportForm configured={configured} />

        <div className="mt-8">
          <h2 className="text-lg font-bold">Recent imports</h2>
          {error ? (
            <p className="mt-3 rounded-lg bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">
              Import history could not be loaded. Please refresh and try again.
            </p>
          ) : runs.length === 0 ? (
            <p className="mt-3 text-sm text-foreground/65">No Companies House imports have run yet.</p>
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
