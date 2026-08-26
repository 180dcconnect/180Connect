import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import {
  EDIT_SUGGESTION_SELECT,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { EditSuggestionsPanel } from "./edit-suggestions-panel";

/**
 * #80/#81 — the admin half of the edit-suggestion system. A CAM cannot write a
 * sensitive client field directly; this queue is where their proposals are decided.
 * Approving applies the value through decide_edit_suggestion after its
 * stale-snapshot guard, so the client record only ever changes by an admin's explicit,
 * audited decision. Rejection leaves the client untouched.
 *
 * F181 will fold this into a single "everything pending your review" tab once the
 * other approval flows exist; until then it is one tile among the /admin queues,
 * same as ownership-requests and suppressions.
 */
export default async function EditSuggestionsPage() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/edit-suggestions",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("edit_suggestions")
    .select(EDIT_SUGGESTION_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<EditSuggestionRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.edit_suggestions.page_list" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Suggested client edits</h1>
        <p className="mt-3 text-sm text-foreground/65">
          CAMs propose corrections to a client&apos;s sensitive fields instead of editing
          them directly. Approving applies the proposed value to the live record;
          rejecting changes nothing. Either way the decision is recorded in the audit
          log and the submitting CAM sees the outcome on the client page.
        </p>

        {error && (
          <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
            The suggested edits could not be loaded. Refresh and try again.
          </p>
        )}

        <EditSuggestionsPanel initialSuggestions={data ?? []} />
      </section>
    </main>
  );
}
