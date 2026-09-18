import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Rise, Stage } from "@/components/dashboard-stage";
import { SUPPRESSION_SELECT, type SuppressionRow } from "@/lib/suppressions";
import { SuppressionsPanel } from "./suppressions-panel";

type OrganisationOption = { id: string; legal_name: string };

/**
 * F251 / F185 — the complete suppression lifecycle: direct admin suppression,
 * CAM request decisions, active blocks, restoration and history.
 *
 * The screen speaks in consequences rather than database state. An admin needs
 * to know whether a client is visible and contactable; internal status values
 * remain at the data boundary. Leadership retains the same evidence without any
 * control the audited writes would refuse.
 */
export default async function SuppressionsPage() {
  const authorization = await getViewingActor("approval:manage", {
    route: "/admin/suppressions",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const canManage = hasPermission(authorization.actor.role, "approval:manage");
  const supabase = await createClient();

  const [suppressions, organisations] = await Promise.all([
    supabase
      .from("suppressions")
      .select(SUPPRESSION_SELECT)
      .order("created_at", { ascending: false })
      .overrideTypes<SuppressionRow[], { merge: false }>(),
    supabase
      .from("organisations")
      .select("id, legal_name")
      .order("legal_name")
      .overrideTypes<OrganisationOption[], { merge: false }>(),
  ]);

  if (suppressions.error) {
    await reportError(suppressions.error, { operation: "admin.suppressions.page_list" });
  }
  if (organisations.error) {
    await reportError(organisations.error, { operation: "admin.suppressions.page_organisations" });
  }

  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Suppress a client
          </h1>
          <p className="mt-4 text-sm leading-[1.65] text-dim">
            Suppression removes a client from normal working lists and stops every outreach
            route. Admin changes take effect immediately; CAM requests wait here for a decision.
            Every change keeps its reason, and an active suppression can be lifted from this page.
          </p>
        </Rise>

        {(suppressions.error || organisations.error) && (
          <Rise>
            <InlineAlert
              variant="page"
              message="Some suppression information could not be loaded. Refresh the page to try again."
              className="!rounded-panel !border-stop/30 !bg-stop-wash !font-medium !text-stop"
            />
          </Rise>
        )}

        <Rise>
          <SuppressionsPanel
            initialSuppressions={suppressions.data ?? []}
            organisations={organisations.data ?? []}
            canManage={canManage}
            suppressionsUnavailable={Boolean(suppressions.error)}
            organisationsUnavailable={Boolean(organisations.error)}
          />
        </Rise>
      </Stage>
    </div>
  );
}
