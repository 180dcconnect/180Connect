"use server";

import { revalidatePath } from "next/cache";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeValidate } from "@/lib/validation";
import { z } from "zod";
import { runIngestion } from "@/lib/ingestion/runner";
import { createThreeSixtyGivingLookupAdapter } from "@/lib/ingestion/sources/threesixtygiving";
import { promotePendingThreeSixtyGivingRecords } from "@/lib/standardize/three-sixty-giving";
import { GRANT_HISTORY_PAGE_SIZE, type GrantRow } from "./grant-list-item";

const loadMoreSchema = z.object({
  organisationId: z.uuid(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(100).optional(),
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

  const limit = parsed.data.limit ?? GRANT_HISTORY_PAGE_SIZE;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("grants")
    .select("id, funder_name, amount_awarded, currency, award_date, grant_programme, description")
    .eq("organisation_id", parsed.data.organisationId)
    .order("award_date", { ascending: false })
    .order("id", { ascending: true })
    .range(parsed.data.offset, parsed.data.offset + limit - 1)
    .returns<GrantRow[]>();

  if (error) {
    await reportError(error, {
      operation: "clients.grant_history_load_more",
      organisationId: parsed.data.organisationId,
    });
    return { ok: false, message: "More grants could not be loaded. Try again." };
  }

  return { ok: true, grants: data, hasMore: data.length === limit };
}

const fetchGrantsSchema = z.object({ organisationId: z.uuid() });

export type FetchGrantsResult =
  | { ok: true; message: string; found: number }
  | { ok: false; message: string };

/**
 * Fetches this one organisation's grant history from 360Giving, on demand.
 *
 * ── Why this is per-client and not a bulk button ──
 *
 * 360Giving is asked one organisation at a time — there is no "all grants since
 * X" endpoint. A walk of the whole client list therefore costs one request per
 * organisation, which at their documented 2 requests/second is ~16 minutes for
 * the list as it stands: unrunnable inside any serverless request, and worse
 * after every import. The queue in three-sixty-giving-backfill.ts exists for
 * that.
 *
 * One organisation is the case that has never been slow. It is a single request,
 * well inside any timeout, and it is also the moment a CAM actually cares —
 * looking at a record and wanting to know whether this charity has taken grants
 * before. So the capability lives here, on the record, rather than on an admin
 * screen nobody visits mid-call.
 *
 * ── Permission ──
 *
 * `client:edit`, matching the charity import rather than the page's own
 * `client:view`. This writes: it creates raw records and grant rows. Viewers
 * read the result like any other part of the record, but do not trigger it.
 */
export async function fetchGrantsForClient(input: unknown): Promise<FetchGrantsResult> {
  const parsed = safeValidate(fetchGrantsSchema, input);
  if (!parsed.success) {
    return { ok: false, message: "That organisation could not be identified." };
  }
  const { organisationId } = parsed.data;

  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const { data: identifiers, error: identifierError } = await supabase
    .from("organisation_identifiers")
    .select("identifier_type, identifier_value")
    .eq("organisation_id", organisationId)
    .in("identifier_type", ["uk_charity", "uk_company"]);

  if (identifierError) {
    await reportError(identifierError, {
      operation: "clients.fetch_grants.load_identifiers",
      organisationId,
    });
    return { ok: false, message: "Grant history could not be checked. Try again." };
  }

  // 360Giving is addressed by registry number. Without one there is nothing to
  // ask, and saying so plainly beats a spinner that ends in "0 found" — the
  // reason is the charity number, not the charity.
  if (!identifiers || identifiers.length === 0) {
    return {
      ok: false,
      message:
        "This organisation has no charity or company number on record, so 360Giving cannot be asked about it.",
    };
  }

  try {
    // Usually one identifier, two for a dual-registered charity. 360Giving
    // treats a company number as an alias of the charity record, so the second
    // lookup normally returns the same grants — the runner's checksum dedup
    // absorbs that rather than writing them twice.
    const adapters = identifiers.map((row) =>
      row.identifier_type === "uk_charity"
        ? createThreeSixtyGivingLookupAdapter({ charityNumber: row.identifier_value })
        : createThreeSixtyGivingLookupAdapter({ companyNumber: row.identifier_value }),
    );

    const summaries = await runIngestion(adapters, {
      triggeredBy: "manual",
      triggeredByUserId: authorization.actor.id,
    });

    const failed = summaries.filter((summary) => summary.status === "failed");
    if (failed.length === summaries.length) {
      // Every lookup failed, which in practice means 360Giving is unreachable
      // rather than that this charity is unknown — an unknown charity 404s and
      // the adapter reads that as "no grants", not as an error.
      return {
        ok: false,
        message:
          "360Giving could not be reached just now. Nothing was changed — try again later.",
      };
    }

    const found = summaries.reduce((total, summary) => total + summary.counts.inserted, 0);
    let matched = 0;
    if (found > 0) {
      matched = (await promotePendingThreeSixtyGivingRecords()).matched;
    }

    // Stamped whatever the answer, so the backfill queue does not ask again
    // tomorrow about an organisation a CAM just checked by hand. "Asked, found
    // nothing" is an answer.
    //
    // Through the admin client, not the caller's: `organisations_update_owner_or_admin`
    // confines a CAM's updates to organisations they own, and this button is
    // deliberately usable on any record. The field is ingestion bookkeeping —
    // when a public API was last read — so it is not the caller's write to make,
    // and widening the RLS policy to allow it would open far more than this.
    const admin = createAdminClient();
    const stampError = admin
      ? (
          await admin
            .from("organisations")
            .update({ grants_fetched_at: new Date().toISOString() })
            .eq("id", organisationId)
        ).error
      : new Error("Supabase admin client is not configured.");

    if (stampError) {
      // Not fatal: the grants are already written. The only cost is the queue
      // asking again later, which is wasted time rather than wrong data.
      await reportError(stampError, {
        operation: "clients.fetch_grants.stamp",
        organisationId,
      });
    }

    revalidatePath(`/clients/${organisationId}`, "layout");

    if (matched > 0) {
      return {
        ok: true,
        found: matched,
        message: `${matched} grant${matched === 1 ? "" : "s"} added to this record.`,
      };
    }

    return {
      ok: true,
      found: 0,
      message: "360Giving has no published grants for this organisation.",
    };
  } catch (error) {
    await reportError(error, { operation: "clients.fetch_grants", organisationId });
    return {
      ok: false,
      message: "Grant history could not be fetched. The failure was recorded.",
    };
  }
}
