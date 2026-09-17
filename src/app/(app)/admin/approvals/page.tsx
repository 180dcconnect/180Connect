import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Rise, Stage } from "@/components/dashboard-stage";
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
 *
 * Leadership (viewer) reads the same queue and decides nothing in it: the two
 * buttons and the rejection box are withheld, `hasPermission` deciding that
 * rather than a role literal, because it is the same question the RPC answers.
 */
export default async function AdminApprovalsPage() {
  const authorization = await getViewingActor("approval:manage", {
    route: "/admin/approvals",
  });
  if (!authorization.ok) {
    redirect(adminRouteDestination(authorization.reason));
  }

  // The exact question the write asks. A viewer is refused here, an admin is
  // not, and a CAM cannot reach the page at all (the gate above).
  const canDecide = hasPermission(authorization.actor.role, "approval:manage");

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
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-8">
        <Rise>
          <header className="space-y-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1] tracking-[-0.03em] text-ink">
                  Approvals
                </h1>
                <p className="mt-3 text-sm leading-[1.65] text-dim">
                  Review changes proposed by Client Account Managers before they reach
                  the live client record.
                </p>
              </div>
              <Link
                className="inline-flex w-fit items-center gap-1.5 rounded-inset px-2 py-1 text-[13px] font-semibold text-lead transition-colors hover:bg-lead-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
                href="/admin"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back to admin
              </Link>
            </div>
          </header>
        </Rise>

        {error && (
          <Rise>
            <InlineAlert
              variant="page"
              className="rounded-panel border-stop/20 bg-stop-wash/60 text-stop"
              message="The approvals list could not be loaded. Refresh the page and try again."
            />
          </Rise>
        )}

        <Rise>
          <ApprovalsPanel initialSuggestions={data ?? []} canDecide={canDecide} />
        </Rise>
      </Stage>
    </div>
  );
}
