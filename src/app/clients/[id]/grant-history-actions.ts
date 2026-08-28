"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";
import { z } from "zod";
import { GRANT_HISTORY_PAGE_SIZE, type GrantRow } from "./grant-list-item";

const loadMoreSchema = z.object({
  organisationId: z.uuid(),
  offset: z.number().int().nonnegative(),
});

export type LoadMoreGrantsResult =
  | { ok: true; grants: GrantRow[]; hasMore: boolean }
  | { ok: false; message: string };

/**
 * F035 — the Grant history section's "Load more". A read, not a mutation, but
 * it lives in a "use server" file because this project has no API routes: the
 * client asks the page-colocated server for the next page of the same ordered
 * query page.tsx renders, so the section's ordering can never drift from the
 * first render.
 *
 * Authorisation mirrors the page's own gate (client:view), and RLS
 * (grants_select_active) confines the read to every active user exactly as it
 * does for the initial page. Ordering is identical to page.tsx — award_date
 * desc with the id as a deterministic tiebreaker, so offset pagination can
 * never skip or duplicate a row when two grants share an award date.
 */
export async function loadMoreGrants(input: unknown): Promise<LoadMoreGrantsResult> {
  const parsed = safeValidate(loadMoreSchema, input);
  if (!parsed.success) {
    return { ok: false, message: "That grant page could not be requested." };
  }

  const authorization = await getCurrentActor("client:view", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("grants")
    .select("id, funder_name, amount_awarded, currency, award_date, grant_programme, description")
    .eq("organisation_id", parsed.data.organisationId)
    .order("award_date", { ascending: false })
    .order("id", { ascending: true })
    .range(parsed.data.offset, parsed.data.offset + GRANT_HISTORY_PAGE_SIZE - 1)
    .returns<GrantRow[]>();

  if (error) {
    await reportError(error, {
      operation: "clients.grant_history_load_more",
      organisationId: parsed.data.organisationId,
    });
    return { ok: false, message: "More grants could not be loaded. Try again." };
  }

  return { ok: true, grants: data, hasMore: data.length === GRANT_HISTORY_PAGE_SIZE };
}
