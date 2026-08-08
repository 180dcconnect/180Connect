import { redirect } from "next/navigation";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { rejectManualEntry } from "./actions";

type Entry = { id: string; legal_name: string; country_code: string; website: string | null; contact_email: string | null; registry_name: string | null; registry_number: string | null; reason_for_manual_entry: string; review_status: string; created_at: string; submitter: { full_name: string | null } | { full_name: string | null }[] | null };

function submitterName(entry: Entry): string {
  const submitter = Array.isArray(entry.submitter) ? entry.submitter[0] : entry.submitter;
  return submitter?.full_name ?? "Unknown CAM";
}

export default async function ManualEntriesPage() {
  const authorization = await getCurrentActor("approval:manage", { route: "/admin/manual-entries" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));
  const supabase = await createClient();
  const { data, error } = await supabase.from("manual_entry_records")
    .select("id, legal_name, country_code, website, contact_email, registry_name, registry_number, reason_for_manual_entry, review_status, created_at, submitter:users!manual_entry_records_submitted_by_user_id_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) await reportError(error, { operation: "manual_entry.admin_list" });
  const entries = (data ?? []) as unknown as Entry[];
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6"><section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
      <p className="text-sm font-bold text-brand">Admin workspace</p><h1 className="mt-2 text-2xl font-bold">Manual client entries</h1>
      <p className="mt-2 text-sm text-foreground/65">Review submissions and see who created them. Approval stays disabled until F042, F046 and F047 are connected.</p>
      {error && <p className="mt-5 rounded-lg bg-red-50 p-3 text-red-800" role="alert">Entries could not be loaded. Refresh and try again.</p>}
      <div className="mt-6 space-y-4">{entries.map((entry) => <article className="rounded-xl border border-black/10 p-5" key={entry.id}>
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">{entry.legal_name}</h2><span className="text-sm font-bold">{entry.review_status}</span></div>
        <p className="mt-1 text-sm text-foreground/65">Submitted by {submitterName(entry)} · {entry.country_code} · {new Date(entry.created_at).toLocaleDateString("en-GB")}</p>
        <p className="mt-3 text-sm">{entry.reason_for_manual_entry}</p>
        {(entry.website || entry.contact_email || entry.registry_number) && <p className="mt-2 text-xs text-foreground/65">{[entry.website, entry.contact_email, entry.registry_name, entry.registry_number].filter(Boolean).join(" · ")}</p>}
        {entry.review_status === "pending" && <div className="mt-4 flex flex-wrap gap-3">
          <button className="cursor-not-allowed rounded-lg bg-gray-200 px-3 py-2 text-sm font-bold text-gray-600" disabled title="F042, F046 and F047 must pass first">Approve (dependencies pending)</button>
          <form action={rejectManualEntry} className="flex flex-1 gap-2"><input name="id" type="hidden" value={entry.id} /><input className="min-w-40 flex-1 rounded-lg border border-black/20 px-3 py-2 text-sm" name="notes" placeholder="Reason for rejection" required minLength={3} /><button className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white" type="submit">Reject</button></form>
        </div>}
      </article>)}</div>
      {!error && entries.length === 0 && <p className="mt-6 text-sm text-foreground/65">No manual entries yet.</p>}
    </section></main>
  );
}
