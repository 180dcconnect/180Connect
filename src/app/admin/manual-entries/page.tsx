import { redirect } from "next/navigation";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { getCurrentActor } from "@/lib/auth/actor";
import { validateClientEmail } from "@/lib/client-email-validation";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { validateWebsiteFormat } from "@/lib/website-validation";
import { ManualEntryReviewForm } from "./review-form";

type Entry = {
  id: string;
  legal_name: string;
  mission_statement: string;
  organisation_type: "charity" | "cio" | "cic" | "social_enterprise" | "ngo" | "company" | "both" | "other";
  address_line_1: string;
  city: string;
  postcode: string;
  country_code: string;
  website: string | null;
  contact_email: string | null;
  registry_name: string | null;
  registry_number: string | null;
  reason_for_manual_entry: string;
  review_status: string;
  created_at: string;
  submitter: { full_name: string | null } | { full_name: string | null }[] | null;
};

function submitterName(entry: Entry): string {
  const submitter = Array.isArray(entry.submitter) ? entry.submitter[0] : entry.submitter;
  return submitter?.full_name ?? "Unknown CAM";
}

export default async function ManualEntriesPage() {
  const authorization = await getCurrentActor("approval:manage", { route: "/admin/manual-entries" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("manual_entry_records")
    .select("id, legal_name, mission_statement, organisation_type, address_line_1, city, postcode, country_code, website, contact_email, registry_name, registry_number, reason_for_manual_entry, review_status, created_at, submitter:users!manual_entry_records_submitted_by_user_id_fkey(full_name)")
    .eq("review_status", "pending")
    .order("created_at", { ascending: false });
  if (error) await reportError(error, { operation: "manual_entry.admin_list" });
  const entries = (data ?? []) as unknown as Entry[];

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-5xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">Admin workspace</p>
        <h1 className="mt-2 text-2xl font-bold">Manual client entries</h1>
        <p className="mt-2 text-sm text-foreground/65">
          Review submissions, run the shared validation and criteria checks, and make
          a human decision when F042 finds a possible duplicate.
        </p>
        {error && (
          <p className="mt-5 rounded-lg bg-red-50 p-3 text-red-800" role="alert">
            Entries could not be loaded. Refresh and try again.
          </p>
        )}
        <div className="mt-6 space-y-4">
          {entries.map((entry) => {
            const emailStatus = validateClientEmail(entry.contact_email);
            const websiteStatus = validateWebsiteFormat(entry.website);
            return (
              <article className="rounded-xl border border-black/10 p-5" key={entry.id}>
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="font-bold">{entry.legal_name}</h2>
                  <span className="text-sm font-bold">{entry.review_status}</span>
                </div>
                <p className="mt-1 text-sm text-foreground/65">
                  Submitted by {submitterName(entry)} · {entry.country_code} · {new Date(entry.created_at).toLocaleDateString("en-GB")}
                </p>
                <p className="mt-3 text-sm">{entry.reason_for_manual_entry}</p>
                <p className="mt-2 text-sm text-foreground/75">{entry.mission_statement}</p>
                <p className="mt-2 text-xs text-foreground/65">
                  {entry.organisation_type} · {entry.address_line_1}, {entry.city}, {entry.postcode}, {entry.country_code}
                </p>
                {(entry.website || entry.contact_email || entry.registry_number) && (
                  <p className="mt-2 text-xs text-foreground/65">
                    {[entry.website, entry.contact_email, entry.registry_name, entry.registry_number].filter(Boolean).join(" · ")}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                  <span className={`rounded-full px-2 py-1 ${emailStatus.status === "invalid" ? "bg-red-100 text-red-800" : emailStatus.status === "valid" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
                    Email: {emailStatus.status}
                  </span>
                  <span className={`rounded-full px-2 py-1 ${websiteStatus.status === "invalid" ? "bg-red-100 text-red-800" : websiteStatus.status === "valid" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
                    Website format: {websiteStatus.status}
                  </span>
                </div>
                {entry.review_status === "pending" && (
                  <ManualEntryReviewForm
                    entryId={entry.id}
                    organisationType={entry.organisation_type}
                  />
                )}
              </article>
            );
          })}
        </div>
        {!error && entries.length === 0 && (
          <p className="mt-6 text-sm text-foreground/65">No manual entries yet.</p>
        )}
      </section>
    </main>
  );
}
