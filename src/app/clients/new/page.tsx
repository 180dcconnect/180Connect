import Link from "next/link";
import { redirect } from "next/navigation";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { ManualEntryForm, type ManualEntryDraft } from "./manual-entry-form";
import { UrlImportForm } from "./url-import-form";

export default async function NewManualClientPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const selectedValue = (await searchParams).draft;
  const selectedId = typeof selectedValue === "string" && /^[0-9a-f-]{36}$/i.test(selectedValue)
    ? selectedValue
    : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("manual_entry_records")
    .select("id, legal_name, mission_statement, organisation_type, address_line_1, city, postcode, country_code, website, contact_email, registry_name, registry_number, reason_for_manual_entry, updated_at, source_url, imported_field_paths, import_notes")
    .eq("submitted_by_user_id", authorization.actor.id)
    .eq("review_status", "draft")
    .order("updated_at", { ascending: false });
  if (error) {
    await reportError(error, {
      operation: "manual_entry.load_drafts",
      actorUserId: authorization.actor.id,
    });
  }
  const drafts = (data ?? []) as ManualEntryDraft[];
  const initialEntry = selectedId
    ? drafts.find((draft) => draft.id === selectedId) ?? null
    : null;

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <Link className="text-sm font-medium text-brand hover:underline" href="/clients">← Clients</Link>
        <h1 className="mt-4 text-2xl font-bold">Add a client</h1>
        <p className="mt-2 text-sm text-foreground/65">
          Use this when an organisation is not available from an API. Start from their
          website, or fill the form in yourself. You can save an
          incomplete draft. {authorization.actor.role === "admin"
            ? "Your completed submission can activate immediately after the shared checks pass."
            : "A completed submission must be approved by an admin before it becomes active."}
        </p>
        {error && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900" role="alert">
            Saved drafts could not be loaded. The failure was recorded; you can still start a new entry.
          </p>
        )}
        {/* Hidden while reviewing an import: the CAM is finishing one, not starting
            another, and a second URL field beside a half-checked draft invites
            replacing it by accident. */}
        {!initialEntry?.source_url && <UrlImportForm />}
        <ManualEntryForm
          drafts={drafts}
          initialEntry={initialEntry}
          isAdmin={authorization.actor.role === "admin"}
        />
      </section>
    </main>
  );
}
