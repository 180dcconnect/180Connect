"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import {
  createDefaultSectorLookupDependencies,
  proposeSectorFromWebsite,
} from "@/lib/sector-from-website";
import { createClient } from "@/lib/supabase/server";

/**
 * Reads a sector off a client's own website, for the admin to review and save.
 *
 * ── It proposes; it does not write ──
 *
 * The twin of readMissionFromWebsiteAction, and deliberately the same shape: it
 * fetches the page, works out which sector the organisation's own words point
 * at, and hands that back with the words it matched. The value reaches the
 * record only when the admin saves it through the existing admin edit path, so
 * sector keeps its single write surface and the proposal is always something a
 * person read first.
 *
 * Admin-only, mirroring the field: `sector` is an admin-edited column, and the
 * card this is called from only renders the control for an admin.
 */

export type SectorLookupState =
  | {
      kind: "proposed";
      /** A preset from the F197 taxonomy — never free text. */
      sector: string;
      /** The category it sits under, so the admin sees where it lands. */
      category: string;
      /** The words that earned it, shown as the reason. */
      matchedTerms: string[];
      /** The site's own sentence it was read from. */
      evidence: string;
      hostname: string;
    }
  | { kind: "skipped"; message: string }
  | { kind: "error"; message: string };

export async function readSectorFromWebsiteAction(input: {
  organisationId: string;
  /** A specific page to read. Defaults to the website on the record. */
  url?: string | null;
}): Promise<SectorLookupState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }
  if (authorization.actor.role !== "admin") {
    return { kind: "error", message: "Only an admin can change the sector." };
  }

  const organisationId = input.organisationId.trim();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisations")
    .select("legal_name, website")
    .eq("id", organisationId)
    .maybeSingle<{ legal_name: string | null; website: string | null }>();

  if (error) {
    await reportError(error, { operation: "clients.sector_lookup_organisation", organisationId });
    return { kind: "error", message: "The client record could not be read. Refresh and try again." };
  }

  const url = input.url?.trim() || data?.website?.trim() || null;
  if (!url) {
    return {
      kind: "error",
      message: "This record has no website on file. Add one first, then read the sector from it.",
    };
  }

  const proposal = await proposeSectorFromWebsite(
    url,
    data?.legal_name ?? null,
    createDefaultSectorLookupDependencies(),
  );

  if (proposal.status === "skipped") {
    return { kind: "skipped", message: proposal.reason };
  }

  return {
    kind: "proposed",
    sector: proposal.sector,
    category: proposal.category,
    matchedTerms: proposal.matchedTerms,
    evidence: proposal.evidence,
    hostname: proposal.hostname,
  };
}
