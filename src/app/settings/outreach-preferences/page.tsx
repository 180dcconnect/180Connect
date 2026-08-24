import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { OutreachPreferencesForm } from "./preferences-form";
import type { GeographicReach, IncomeBand } from "./constants";

type OutreachPreferencesRow = {
  preferred_geographic_reach: GeographicReach[] | null;
  preferred_cities: string[] | null;
  preferred_sectors: string[] | null;
  preferred_income_bands: IncomeBand[] | null;
  prioritise_grant_recipients: boolean | null;
  first_follow_up_days: number | null;
  second_follow_up_days: number | null;
};

export default async function OutreachPreferencesPage() {
  // F200 review — permission boundary: the settings rail hides this row behind
  // `client:edit` (a viewer has no outreach to target), so the page enforces the
  // same permission rather than letting a direct URL reach a form the rail says
  // they should not have. Same gate as the save action below us.
  const authorization = await getCurrentActor("client:edit", {
    route: "/settings/outreach-preferences",
  });
  if (!authorization.ok) {
    redirect(adminRouteDestination(authorization.reason));
  }

  const supabase = await createClient();
  // F187 gave admins read access to every CAM's preferences row (matrix §3.13,
  // outreach_preferences_select_admin) so they can review how a CAM's queue is
  // configured. RLS therefore no longer scopes this query to the caller — filter
  // explicitly, or an admin's maybeSingle matches every CAM and errors out.
  const { data, error } = await supabase
    .from("outreach_preferences")
    .select("preferred_geographic_reach, preferred_cities, preferred_sectors, preferred_income_bands, prioritise_grant_recipients, first_follow_up_days, second_follow_up_days")
    .eq("user_id", authorization.actor.id)
    .maybeSingle<OutreachPreferencesRow>();

  // F200 review — DoD (every failure visible and recorded): an ignored error here
  // rendered "No preference" over preferences that may well exist. Logged and
  // surfaced through the shared F236 InlineAlert, same as the rest of the app.
  if (error) {
    await reportError(error, { operation: "settings.outreach_preferences.page_load" });
  }

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-2xl space-y-10">
        <Rise>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
            Outreach preferences
          </h1>
          <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
            Set the geography, sector, size, grant funding focus and follow-up cadence for your outreach workflow.
          </p>
        </Rise>

        {error ? (
          <Rise>
            <InlineAlert
              variant="page"
              message="Your preferences could not be loaded. Please refresh and try again."
            />
          </Rise>
        ) : (
          <Rise>
            <OutreachPreferencesForm
              initialGeographicReach={data?.preferred_geographic_reach ?? []}
              initialCities={data?.preferred_cities ?? []}
              initialSectors={data?.preferred_sectors ?? []}
              initialIncomeBands={data?.preferred_income_bands ?? []}
              initialPrioritiseGrants={data?.prioritise_grant_recipients ?? false}
              initialFirstFollowUpDays={data?.first_follow_up_days ?? 7}
              initialSecondFollowUpDays={data?.second_follow_up_days ?? 14}
            />
          </Rise>
        )}
      </Stage>
    </div>
  );
}
