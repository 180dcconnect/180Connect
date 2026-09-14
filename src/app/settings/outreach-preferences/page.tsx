import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { incomeRangeFromBands } from "@/lib/income-range";
import { OutreachPreferencesForm } from "./preferences-form";
import {
  DEFAULT_FIRST_FOLLOW_UP_DAYS,
  DEFAULT_SECOND_FOLLOW_UP_DAYS,
  type GeographicReach,
  type IncomeBand,
} from "./constants";

type OutreachPreferencesRow = {
  preferred_geographic_reach: GeographicReach[] | null;
  preferred_cities: string[] | null;
  preferred_sectors: string[] | null;
  preferred_income_bands: IncomeBand[] | null;
  preferred_income_min: number | null;
  preferred_income_max: number | null;
  prioritise_grant_recipients: boolean | null;
  first_follow_up_days: number | null;
  second_follow_up_days: number | null;
  updated_at: string | null;
};

/**
 * Outreach preferences (F195–F199, F202) — Filed Record redesign.
 *
 * Same skeleton as the other settings screens: heading, one rail of facts,
 * cards. The rail answers the question the old lede did not: is anything set,
 * and since when. The form keeps its read-first shape — a summary with an Edit
 * action, opening into the full editor.
 */
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
    .select(
      "preferred_geographic_reach, preferred_cities, preferred_sectors, preferred_income_bands, preferred_income_min, preferred_income_max, prioritise_grant_recipients, first_follow_up_days, second_follow_up_days, updated_at",
    )
    .eq("user_id", authorization.actor.id)
    .maybeSingle<OutreachPreferencesRow>();

  // F200 review — DoD (every failure visible and recorded): an ignored error here
  // rendered "No preference" over preferences that may well exist. Logged and
  // surfaced through the shared F236 InlineAlert, same as the rest of the app.
  if (error) {
    await reportError(error, { operation: "settings.outreach_preferences.page_load" });
  }

  // A row with bands but no range was saved before ranges existed and has not
  // been through 20261004160000's backfill — show the range those bands cover.
  const hasRange = data?.preferred_income_min != null || data?.preferred_income_max != null;
  const incomeRange = hasRange
    ? { min: data?.preferred_income_min ?? null, max: data?.preferred_income_max ?? null }
    : incomeRangeFromBands(data?.preferred_income_bands);

  const lastSaved = data?.updated_at
    ? new Date(data.updated_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      })
    : null;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Outreach preferences
          </h1>
          {!error && (
            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${lastSaved ? "bg-go" : "bg-faint"}`}
              />
              {lastSaved ? (
                <span>
                  Shapes the order of your own client queue · last saved{" "}
                  <span className="text-ink">{lastSaved}</span>
                </span>
              ) : (
                <span>
                  Not set yet · your queue is in its default order, with reminders at{" "}
                  {DEFAULT_FIRST_FOLLOW_UP_DAYS} and {DEFAULT_SECOND_FOLLOW_UP_DAYS} days
                </span>
              )}
            </p>
          )}
        </Rise>

        <Group>
          <Rise>
            {error ? (
              <InlineAlert
                variant="page"
                message="Your preferences could not be loaded. Please refresh and try again."
              />
            ) : (
              <OutreachPreferencesForm
                initial={{
                  geographicReach: data?.preferred_geographic_reach ?? [],
                  cities: data?.preferred_cities ?? [],
                  sectors: data?.preferred_sectors ?? [],
                  incomeMin: incomeRange.min,
                  incomeMax: incomeRange.max,
                  prioritiseGrantRecipients: data?.prioritise_grant_recipients ?? false,
                  firstFollowUpDays: data?.first_follow_up_days ?? DEFAULT_FIRST_FOLLOW_UP_DAYS,
                  secondFollowUpDays:
                    data?.second_follow_up_days ?? DEFAULT_SECOND_FOLLOW_UP_DAYS,
                }}
              />
            )}
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
