import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  EDIT_SUGGESTION_SELECT,
  type EditSuggestionRow,
} from "@/lib/edit-suggestions";
import { ApprovalsPanel } from "./approvals-panel";

/**
 * F181 (#177) — Approval Tab.
 *
 * Dedicated admin approvals workspace where proposed client field edits
 * (F077–F079) are reviewed and decided. All decisions run through the audited
 * `decide_edit_suggestion` RPC with stale-snapshot checks. Approving applies
 * the verified value to the live client record; rejecting logs the reason and
 * leaves the record intact.
 */
export default async function AdminApprovalsPage() {
  const authorization = await getCurrentActor("approval:manage", {
    route: "/admin/approvals",
  });
  if (!authorization.ok) {
    redirect(adminRouteDestination(authorization.reason));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("edit_suggestions")
    .select(EDIT_SUGGESTION_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<EditSuggestionRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.approvals.page_list" });
  }

  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-4xl rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-brand">Admin workspace</p>
            <h1 className="mt-1 text-3xl font-bold">Approvals</h1>
          </div>
          <Link
            className="text-sm font-bold text-brand hover:underline"
            href="/admin"
          >
            Back to admin
          </Link>
        </div>

        {error && (
          <div className="mt-5">
            <InlineAlert
              variant="page"
              message="The pending approvals could not be loaded. Please refresh and try again."
            />
          </div>
        )}

        <ApprovalsPanel initialSuggestions={data ?? []} />
      </section>
    </main>
  );
}
