"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import {
  createDefaultMissionLookupDependencies,
  proposeMissionFromWebsite,
} from "@/lib/mission-from-website";
import { createClient } from "@/lib/supabase/server";

/**
 * Reads the mission off a client's own website, for the admin to review and save.
 *
 * ── It proposes; it does not write ──
 *
 * The record's mission is written in exactly one place today: the admin edit
 * path in admin-actions.ts (an enrichment row at confidence 1). This action adds
 * no second writer. It fetches the page, hands back the description the site
 * publishes about itself, and the admin edits and saves it through that same
 * path — so the value that lands on the record is one a person read first, and
 * mission keeps its single write surface.
 *
 * Admin-only, mirroring the field. `mission_statement` is not a column on
 * organisations, so it can never be a restricted field, so a CAM has no proposal
 * route for it — the General Information card already gives only an admin the
 * pencil on that row, and this affordance lives inside that editor.
 */

export type MissionLookupState =
  | { kind: "proposed"; mission: string; hostname: string }
  | { kind: "skipped"; message: string }
  | { kind: "error"; message: string };

export async function readMissionFromWebsiteAction(input: {
  organisationId: string;
  /** A specific page to read. Defaults to the website on the record. */
  url?: string | null;
}): Promise<MissionLookupState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }
  if (authorization.actor.role !== "admin") {
    return { kind: "error", message: "Only an admin can change the mission." };
  }

  const organisationId = input.organisationId.trim();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisations")
    .select("legal_name, website")
    .eq("id", organisationId)
    .maybeSingle<{ legal_name: string | null; website: string | null }>();

  if (error) {
    await reportError(error, { operation: "clients.mission_lookup_organisation", organisationId });
    return { kind: "error", message: "The client record could not be read. Refresh and try again." };
  }

  const url = input.url?.trim() || data?.website?.trim() || null;
  if (!url) {
    return {
      kind: "error",
      message: "This record has no website on file. Add one above, then read the mission from it.",
    };
  }

  const proposal = await proposeMissionFromWebsite(url, data?.legal_name ?? null, createDefaultMissionLookupDependencies());

  if (proposal.status === "skipped") {
    return { kind: "skipped", message: proposal.reason };
  }

  return { kind: "proposed", mission: proposal.mission, hostname: proposal.hostname };
}
