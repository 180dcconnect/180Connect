import { redirect } from "next/navigation";

import { adminRouteDestination } from "@/lib/auth/admin-route";
import { getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { manualDraftLoadErrorMessage } from "@/lib/manual-entry";
import { createClient } from "@/lib/supabase/server";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { NewClientButton, NewClientConsole } from "./new-client-console";
import { NewClientHeader } from "./new-client-header";
import { DraftList, RecentlyAdded, type RecentSubmission } from "./submission-lists";
import type { ManualEntryDraft } from "./manual-entry-form";

/**
 * Add a client.
 *
 * ── The shape ──
 *
 * The Data imports heading block, then the Charity Commission screen's
 * two-view console: a landing view of what was added recently and what is still
 * in draft, with "Add a client" on its header, and the composer entered from it.
 *
 * ── Why the queries are shaped the way they are ──
 *
 * Both run together; either can fail without taking the other with it, and the
 * draft failure has its own message because losing a draft is the one failure
 * here a person can act on. Neither is allowed to fail the page: someone who
 * cannot see their drafts can still add a client.
 */
export default async function NewManualClientPage({
  searchParams,
}: {
  searchParams: Promise<{
    draft?: string | string[];
    contact_email?: string | string[];
    /** The entry just submitted from the composer, to confirm and highlight. */
    added?: string | string[];
  }>;
}) {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const isAdmin = authorization.actor.role === "admin";
  const params = await searchParams;
  const selectedValue = params.draft;
  const selectedId =
    typeof selectedValue === "string" && /^[0-9a-f-]{36}$/i.test(selectedValue)
      ? selectedValue
      : null;
  const addedValue = params.added;
  const addedId =
    typeof addedValue === "string" && /^[0-9a-f-]{36}$/i.test(addedValue) ? addedValue : null;
  const supabase = await createClient();
  const [{ data, error }, { data: recentData, error: recentError }] = await Promise.all([
    supabase
      .from("manual_entry_records")
      .select(
        "id, legal_name, mission_statement, organisation_type, address_line_1, city, postcode, country_code, website, contact_email, contact_email_role_confirmed_for, registry_name, registry_number, reason_for_manual_entry, updated_at, source_url, imported_field_paths, import_notes, sector, geographic_reach, latest_income, accounts_year_end, staff_count, volunteer_count",
      )
      .eq("submitted_by_user_id", authorization.actor.id)
      .eq("review_status", "draft")
      .order("updated_at", { ascending: false }),
    // What became of this person's last few submissions — the drafts query above
    // only ever sees work still in progress.
    supabase
      .from("manual_entry_records")
      .select("id, legal_name, review_status, converted_to_organisation_id, updated_at")
      .eq("submitted_by_user_id", authorization.actor.id)
      .in("review_status", ["pending", "approved", "rejected"])
      .order("updated_at", { ascending: false })
      .limit(8),
  ]);
  if (error) {
    await reportError(error, {
      operation: "manual_entry.load_drafts",
      actorUserId: authorization.actor.id,
    });
  }
  if (recentError) {
    await reportError(recentError, {
      operation: "manual_entry.load_recent_submissions",
      actorUserId: authorization.actor.id,
    });
  }
  const drafts = (data ?? []) as ManualEntryDraft[];
  const recentSubmissions = (recentData ?? []) as RecentSubmission[];
  const draftLoadMessage = error
    ? manualDraftLoadErrorMessage(error, process.env.NODE_ENV === "development")
    : null;
  const initialEntry = selectedId ? (drafts.find((draft) => draft.id === selectedId) ?? null) : null;
  // Prefill for arrivals from the inbox compose window ("Add Client" links
  // /clients/new?contact_email=...). Shaped-checked and capped like the form's
  // own column (320); a draft under review always wins over the prefill.
  const contactEmailParam = params.contact_email;
  const prefillContactEmail =
    typeof contactEmailParam === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmailParam.trim())
      ? contactEmailParam.trim().slice(0, 320)
      : null;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      {/* Same max-w-6xl as the import screens, so the shared tab row lands on
          the same pixel as the other Data imports tabs. */}
      <Stage className="mx-auto max-w-6xl space-y-8">
        <Rise>
          <header>
            <NewClientHeader />
            <p className="mt-4 text-sm leading-[1.7] text-dim">
              Find the organisation in a register we hold, read it from their website, or type
              it in.{" "}
              {isAdmin
                ? "What you add goes straight onto the client list."
                : "An admin approves what you submit before it joins the client list."}
            </p>
          </header>
        </Rise>

        <Group>
          <Rise>
            <NewClientConsole
              // Next keys a page without its search params, so following a
              // draft link (?draft=…) would reuse the mounted console and its
              // state — a blank composer — instead of opening the draft. Keying
              // on what the URL asked for remounts it onto that draft; stepping
              // back to /clients/new remounts it onto the lists.
              key={initialEntry?.id ?? (prefillContactEmail ? `email:${prefillContactEmail}` : "home")}
              home={
                <>
                  <RecentlyAdded
                    action={<NewClientButton />}
                    highlightId={addedId}
                    isAdmin={isAdmin}
                    recent={recentSubmissions}
                  />
                  <DraftList draftLoadMessage={draftLoadMessage} drafts={drafts} />
                </>
              }
              // A chosen draft, or an arrival from the inbox with an email to
              // add, means the person came to fill the form, not to read lists.
              initialEntry={initialEntry}
              initialMode={initialEntry || prefillContactEmail ? "composer" : "home"}
              isAdmin={isAdmin}
              prefillContactEmail={initialEntry?.contact_email ?? prefillContactEmail}
            />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
