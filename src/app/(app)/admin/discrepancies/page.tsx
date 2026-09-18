import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Rise, Stage } from "@/components/dashboard-stage";
import { FIELD_DISCREPANCY_SELECT, type FieldDiscrepancyRow } from "@/lib/discrepancies";
import { DiscrepanciesPanel } from "./discrepancies-panel";

/**
 * F048 — cross-source disagreements that the standardisation rules cannot settle.
 *
 * This screen is for an admin who understands the client, not the database. It
 * therefore presents one plain-English comparison at a time and keeps source
 * codes, column names and the mechanics of the merge out of the interface.
 * Leadership gets the same queue and complete decision history, but no controls.
 */
export default async function DiscrepanciesPage() {
  const authorization = await getViewingActor("approval:manage", {
    route: "/admin/discrepancies",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  // The page asks the same permission as the PATCH write. A viewer reads every
  // disagreement and its history, but is never offered a control that will fail.
  const canDecide = hasPermission(authorization.actor.role, "approval:manage");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("field_discrepancies")
    .select(FIELD_DISCREPANCY_SELECT)
    .order("created_at", { ascending: false })
    .overrideTypes<FieldDiscrepancyRow[], { merge: false }>();

  if (error) {
    await reportError(error, { operation: "admin.discrepancies.page_list" });
  }

  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Data discrepancies
          </h1>
          <p className="mt-4 text-sm leading-[1.65] text-dim">
            When two trusted sources give different details for the same client, neither one
            replaces the other automatically. Compare both values here and choose which one
            belongs on the client record.
          </p>
        </Rise>

        {error && (
          <Rise>
            <InlineAlert
              variant="page"
              message="Some data could not be loaded. Refresh the page to try again."
              className="!rounded-panel !border-stop/30 !bg-stop-wash !font-medium !text-stop"
            />
          </Rise>
        )}

        <Rise>
          <DiscrepanciesPanel initialDiscrepancies={data ?? []} canDecide={canDecide} />
        </Rise>
      </Stage>
    </div>
  );
}
