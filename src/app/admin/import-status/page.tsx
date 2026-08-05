// F039: Import Status Tracking.
//
// Structure copied directly from src/app/admin/offboard/page.tsx (the real,
// existing pattern for an admin Server Component page): getCurrentActor for
// the permission gate, a direct Supabase query for the data, reportError on
// a query failure, plain server-rendered markup (no client panel needed here
// — this page has no interactive actions, just a table).
//
// Permission: "platform-settings:manage" is used as the closest existing fit
// (admin-only, matches ingestion_runs' RLS policy per F038's migration
// comment: "SELECT admin-only"). No dedicated "view import status"
// permission exists in src/lib/auth/permissions.ts yet — this is an
// assumption, not a confirmed decision; worth checking whether the team
// wants a dedicated permission added to the matrix instead.
//
// AC3 ("failed runs visible without checking server logs"): a failed run's
// error_message is now shown directly in the table as a second row under it,
// not just the status badge — knowing something failed without knowing why
// still sends someone to the logs, which is what this AC exists to avoid.

import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { StatusBadge } from "./status-badge";

export type IngestionRunRow = {
  id: string;
  api_source: string;
  job_status: "running" | "completed" | "failed" | "partial";
  records_fetched: number;
  records_inserted: number;
  records_skipped: number;
  records_failed: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
};

export default async function AdminImportStatusPage() {
  const authorization = await getCurrentActor("platform-settings:manage", {
    route: "/admin/import-status",
  });
  if (!authorization.ok) {
    if (authorization.reason === "unauthenticated") redirect("/login");
    redirect("/dashboard?error=admin-access-required");
  }

  const supabase = await createClient();
  const { data: runs, error } = await supabase
    .from("ingestion_runs")
    .select(
      "id, api_source, job_status, records_fetched, records_inserted, records_skipped, records_failed, started_at, completed_at, error_message",
    )
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    await reportError(error, { operation: "admin.import_status.page_list" });
  }

  const rows = (runs ?? []) as IngestionRunRow[];

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">Admin workspace</p>
        <h1 className="mt-2 text-3xl font-bold">Import status</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Every data ingestion run, most recent first — whether it succeeded,
          partially succeeded, or failed, and how many records were affected.
        </p>

        {error && (
          <p
            className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800"
            role="alert"
          >
            Import history could not be loaded. Please refresh and try again.
          </p>
        )}

        {!error && rows.length === 0 && (
          <p className="mt-5 text-sm text-foreground/65">
            No import runs recorded yet.
          </p>
        )}

        {rows.length > 0 && (
          <table className="mt-6 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-foreground/60">
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Fetched</th>
                <th className="py-2 pr-4 font-medium">Inserted</th>
                <th className="py-2 pr-4 font-medium">Skipped</th>
                <th className="py-2 pr-4 font-medium">Failed</th>
                <th className="py-2 pr-4 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <>
                  <tr key={run.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {run.api_source}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={run.job_status} />
                    </td>
                    <td className="py-2 pr-4">{run.records_fetched}</td>
                    <td className="py-2 pr-4">{run.records_inserted}</td>
                    <td className="py-2 pr-4">{run.records_skipped}</td>
                    <td className="py-2 pr-4">{run.records_failed}</td>
                    <td className="py-2 pr-4 text-foreground/60">
                      {new Date(run.started_at).toLocaleString()}
                    </td>
                  </tr>
                  {run.job_status === "failed" && run.error_message && (
                    <tr
                      key={`${run.id}-error`}
                      className="border-b border-foreground/5 bg-red-50/50"
                    >
                      <td colSpan={7} className="py-2 pr-4 text-xs text-red-800">
                        {run.error_message}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}