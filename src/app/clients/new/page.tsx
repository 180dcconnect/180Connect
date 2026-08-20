import Link from "next/link";
import { redirect } from "next/navigation";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { manualDraftLoadErrorMessage } from "@/lib/manual-entry";
import { createClient } from "@/lib/supabase/server";
import { Stage, Rise } from "@/components/dashboard-stage";
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
  const draftLoadMessage = error
    ? manualDraftLoadErrorMessage(error, process.env.NODE_ENV === "development")
    : null;
  const initialEntry = selectedId
    ? drafts.find((draft) => draft.id === selectedId) ?? null
    : null;

  // Bone ground, floating cards — the same shell as /dashboard, /clients and
  // /admin/audit-log (docs/design-system.md §Inside the app). Root is a `div`:
  // AppShell already renders the `main` this slots into.
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl">
        <Rise>
          <Link
            className="group inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40 transition-colors hover:text-foreground/70"
            href="/clients"
          >
            <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            Clients
          </Link>

          <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            Manual entry
          </p>
          <h1 className="mt-2 text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Add a client
          </h1>
          <p className="mt-3 max-w-prose text-sm leading-[1.7] text-foreground/65">
            Use this when an organisation is not available from an API. Start from their
            website, or fill the form in yourself. You can save an
            incomplete draft. {authorization.actor.role === "admin"
              ? "Your completed submission can activate immediately after the shared checks pass."
              : "A completed submission must be approved by an admin before it becomes active."}
          </p>
        </Rise>

        {draftLoadMessage && (
          <Rise>
            <p
              role="alert"
              className="mt-6 rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4 text-sm font-bold text-destructive"
            >
              {draftLoadMessage}
            </p>
          </Rise>
        )}

        {/* Hidden while reviewing an import: the CAM is finishing one, not starting
            another, and a second URL field beside a half-checked draft invites
            replacing it by accident. */}
        {!initialEntry?.source_url && (
          <Rise>
            <div className="mt-6">
              <UrlImportForm />
            </div>
          </Rise>
        )}

        <Rise>
          <div className="mt-6">
            <ManualEntryForm
              drafts={drafts}
              initialEntry={initialEntry}
              isAdmin={authorization.actor.role === "admin"}
            />
          </div>
        </Rise>
      </Stage>
    </div>
  );
}
