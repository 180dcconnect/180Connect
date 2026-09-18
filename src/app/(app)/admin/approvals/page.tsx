import { redirect } from "next/navigation";
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
import { validateClientEmail } from "@/lib/client-email-validation";
import {
  MANUAL_ENTRY_REVIEW_SELECT,
  type ManualEntryReviewRow,
} from "@/lib/manual-entry";
import { validateWebsiteFormat } from "@/lib/website-validation";
import type { OrganisationSource } from "@/lib/organisation-source-links";
import { ApprovalsPanel } from "./approvals-panel";

/**
 * F181 (#177) — Approval Tab.
 *
 * The one workspace where proposed client work is reviewed and decided:
 * field edits (F077–F079) on the Awaiting review tab, whole new clients
 * submitted by CAMs (F036) on the New clients tab. Edit decisions run through
 * the audited `decide_edit_suggestion` RPC with stale-snapshot checks —
 * approving applies the verified value to the live client record; manual-entry
 * decisions run through the audited `approve_manual_entry` / `reject_manual_entry`
 * RPCs, which create (or link) the organisation. Rejecting logs the reason and
 * leaves the record intact either way.
 *
 * Leadership (viewer) reads the same queues and decides nothing in them: every
 * decision control is withheld, `hasPermission` deciding that rather than a
 * role literal, because it is the same question the RPCs answer.
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
  // Either queue can fail without taking the other down: a CAM whose edits
  // cannot load can still have their new clients decided, and vice versa.
  const [{ data, error }, { data: manualEntriesData, error: manualEntriesError }] =
    await Promise.all([
      supabase
        .from("edit_suggestions")
        .select(EDIT_SUGGESTION_SELECT)
        .order("created_at", { ascending: false })
        .overrideTypes<EditSuggestionRow[], { merge: false }>(),
      supabase
        .from("manual_entry_records")
        .select(MANUAL_ENTRY_REVIEW_SELECT)
        .in("review_status", ["pending", "approved", "rejected"])
        .order("created_at", { ascending: false })
        .overrideTypes<ManualEntryReviewRow[], { merge: false }>(),
    ]);

  if (error) {
    await reportError(error, { operation: "admin.approvals.page_list" });
  }
  if (manualEntriesError) {
    await reportError(manualEntriesError, { operation: "admin.approvals.page_manual_entries" });
  }

  const rows = data ?? [];
  const manualEntries = manualEntriesData ?? [];

  /**
   * Email/website badges for the New clients tab, read here rather than in the
   * cards: the format checkers need Node (`website-validation` calls
   * `node:net`), so they cannot run in the client bundle.
   */
  const manualEntryBadges: Record<string, { email: string; website: string }> = {};
  for (const entry of manualEntries) {
    manualEntryBadges[entry.id] = {
      email: validateClientEmail(entry.contact_email).status,
      website: validateWebsiteFormat(entry.website).status,
    };
  }

  /**
   * What each card's "Check the source" row needs to offer its links: the
   * register numbers and the live website behind the client, read once for the
   * whole queue rather than per decision.
   *
   * The first number of each registry wins, the same rule the duplicate-review
   * screen uses (`src/lib/duplicates.ts`): a second charity number for one
   * organisation is not something this row has anything to say about.
   */
  const sourceByOrganisation: Record<string, OrganisationSource> = {};
  for (const row of rows) {
    if (sourceByOrganisation[row.organisation_id]) continue;

    let charityNumber: string | null = null;
    let companyNumber: string | null = null;
    for (const identifier of row.organisations?.organisation_identifiers ?? []) {
      const value = identifier.identifier_value?.trim();
      if (!value) continue;
      if (identifier.identifier_type === "uk_charity" && !charityNumber) charityNumber = value;
      if (identifier.identifier_type === "uk_company" && !companyNumber) companyNumber = value;
    }

    sourceByOrganisation[row.organisation_id] = {
      charityNumber,
      companyNumber,
      website: row.organisations?.website ?? null,
    };
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
                  Review changes proposed by Client Acquisition Managers before they reach
                  the live client record — field edits and whole new clients alike.
                </p>
              </div>
            </div>
          </header>
        </Rise>

        {(error || manualEntriesError) && (
          <Rise>
            <InlineAlert
              variant="page"
              className="rounded-panel border-stop/20 bg-stop-wash/60 text-stop"
              message="Some approval information could not be loaded. Refresh the page and try again."
            />
          </Rise>
        )}

        <Rise>
          <ApprovalsPanel
            initialSuggestions={rows}
            initialManualEntries={manualEntries}
            manualEntryBadges={manualEntryBadges}
            canDecide={canDecide}
            sourceByOrganisation={sourceByOrganisation}
          />
        </Rise>
      </Stage>
    </div>
  );
}
