import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { Rise, Stage } from "@/components/dashboard-stage";
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
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/outreach-preferences",
  });
  if (!authorization.ok) {
    redirect("/login");
  }

  const supabase = await createClient();
  // RLS scopes this to the caller's own row (docs/rls-permission-matrix.md §3.13) —
  // no user_id filter needed here, there is nothing else this query could return.
  const { data } = await supabase
    .from("outreach_preferences")
    .select("preferred_geographic_reach, preferred_cities, preferred_sectors, preferred_income_bands, prioritise_grant_recipients, first_follow_up_days, second_follow_up_days")
    .maybeSingle<OutreachPreferencesRow>();

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
      </Stage>
    </div>
  );
}
