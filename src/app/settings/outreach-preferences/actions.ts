"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { recordOnboardingStepAction } from "@/lib/onboarding-actions";
import { reportError } from "@/lib/error-logging";
import {
  GEOGRAPHIC_REACH_OPTIONS,
  INCOME_BAND_OPTIONS,
  MAX_CITY_LENGTH,
  MAX_CITIES,
  MAX_SECTOR_LENGTH,
  MAX_SECTORS,
  type GeographicReach,
  type IncomeBand,
} from "./constants";

export type OutreachPreferencesState = {
  status: "idle" | "error" | "success";
  message?: string;
  /**
   * The preferences as actually stored, echoed back on success. The read-only
   * view renders these rather than its own copy of the draft, so what is on
   * screen after a save is what the parser kept — trimmed, deduplicated and
   * capped — not what was typed.
   */
  saved?: {
    geographicReach: GeographicReach[];
    cities: string[];
    sectors: string[];
    incomeBands: IncomeBand[];
    prioritiseGrantRecipients: boolean;
  };
};

const GEOGRAPHIC_REACH_SET = new Set<string>(GEOGRAPHIC_REACH_OPTIONS);
const INCOME_BAND_SET = new Set<string>(INCOME_BAND_OPTIONS);

/**
 * Trusts nothing from the client past its shape: a tampered POST could submit any
 * string for geo/income, so both are filtered against the actual enum rather than
 * cast. Sectors and cities are free text (no enum to check against, see constants.ts)
 * but are still trimmed, deduplicated and length/count-capped so a form bug or a
 * hostile client can't grow the array without bound.
 */
function parsePreferences(formData: FormData): {
  geographicReach: GeographicReach[];
  cities: string[];
  sectors: string[];
  incomeBands: IncomeBand[];
  prioritiseGrantRecipients: boolean;
} {
  const geographicReach = formData
    .getAll("geographic_reach")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => GEOGRAPHIC_REACH_SET.has(value)) as GeographicReach[];

  const incomeBands = formData
    .getAll("income_band")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => INCOME_BAND_SET.has(value)) as IncomeBand[];

  const seenCities = new Set<string>();
  const cities: string[] = [];
  for (const raw of formData.getAll("city")) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_CITY_LENGTH) continue;
    const key = trimmed.toLowerCase();
    if (seenCities.has(key)) continue;
    seenCities.add(key);
    cities.push(trimmed);
    if (cities.length >= MAX_CITIES) break;
  }

  const seenSectors = new Set<string>();
  const sectors: string[] = [];
  for (const raw of formData.getAll("sector")) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_SECTOR_LENGTH) continue;
    const key = trimmed.toLowerCase();
    if (seenSectors.has(key)) continue;
    seenSectors.add(key);
    sectors.push(trimmed);
    if (sectors.length >= MAX_SECTORS) break;
  }

  const rawGrant = formData.get("prioritise_grant_recipients");
  const prioritiseGrantRecipients = rawGrant === "true" || rawGrant === "on" || rawGrant === "1";

  return { geographicReach, cities, sectors, incomeBands, prioritiseGrantRecipients };
}

export async function saveOutreachPreferencesAction(
  _previousState: OutreachPreferencesState,
  formData: FormData,
): Promise<OutreachPreferencesState> {
  const authorization = await getCurrentActor(undefined, {
    route: "/settings/outreach-preferences",
  });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const { geographicReach, cities, sectors, incomeBands, prioritiseGrantRecipients } = parsePreferences(formData);

  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_preferences")
    .upsert(
      {
        user_id: authorization.actor.id,
        preferred_geographic_reach: geographicReach,
        preferred_cities: cities,
        preferred_sectors: sectors,
        preferred_income_bands: incomeBands,
        prioritise_grant_recipients: prioritiseGrantRecipients,
      },
      { onConflict: "user_id" },
    );

  if (error) {
    return {
      status: "error",
      message: "Could not save your preferences. Try again.",
    };
  }

  // F255 step 1 is recorded here rather than when the CAM opens this screen: the
  // guide claims they have set their preferences, and this is the point at which
  // that becomes true. Failure is swallowed on purpose — a checklist tick is not
  // worth telling someone their saved preferences did not save. The try/catch
  // covers exceptions (not just the {ok:false} path), so an unexpected throw here
  // can never take the successful upsert down with it.
  try {
    await recordOnboardingStepAction("outreach_preferences");
  } catch (err) {
    await reportError(err, { operation: "onboarding.record_step_from_preferences" });
  }

  revalidatePath("/settings/outreach-preferences");
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  return {
    status: "success",
    message: "Preferences saved.",
    saved: { geographicReach, cities, sectors, incomeBands, prioritiseGrantRecipients },
  };
}
