"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import {
  GEOGRAPHIC_REACH_OPTIONS,
  INCOME_BAND_OPTIONS,
  MAX_SECTOR_LENGTH,
  MAX_SECTORS,
  type GeographicReach,
  type IncomeBand,
} from "./constants";

export type OutreachPreferencesState = {
  status: "idle" | "error" | "success";
  message?: string;
};

const GEOGRAPHIC_REACH_SET = new Set<string>(GEOGRAPHIC_REACH_OPTIONS);
const INCOME_BAND_SET = new Set<string>(INCOME_BAND_OPTIONS);

/**
 * Trusts nothing from the client past its shape: a tampered POST could submit any
 * string for geo/income, so both are filtered against the actual enum rather than
 * cast. Sectors are free text (no enum to check against, see constants.ts) but are
 * still trimmed, deduplicated and length/count-capped so a form bug or a hostile
 * client can't grow the array without bound.
 */
function parsePreferences(formData: FormData): {
  geographicReach: GeographicReach[];
  sectors: string[];
  incomeBands: IncomeBand[];
} {
  const geographicReach = formData
    .getAll("geographic_reach")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => GEOGRAPHIC_REACH_SET.has(value)) as GeographicReach[];

  const incomeBands = formData
    .getAll("income_band")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => INCOME_BAND_SET.has(value)) as IncomeBand[];

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

  return { geographicReach, sectors, incomeBands };
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

  const { geographicReach, sectors, incomeBands } = parsePreferences(formData);

  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_preferences")
    .upsert(
      {
        user_id: authorization.actor.id,
        preferred_geographic_reach: geographicReach,
        preferred_sectors: sectors,
        preferred_income_bands: incomeBands,
      },
      { onConflict: "user_id" },
    );

  if (error) {
    return {
      status: "error",
      message: "Could not save your preferences. Try again.",
    };
  }

  revalidatePath("/settings/outreach-preferences");
  return { status: "success", message: "Preferences saved." };
}
