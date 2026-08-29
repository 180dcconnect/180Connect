"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";
import { z } from "zod";
import {
  FINANCIAL_FILINGS_PAGE_SIZE,
  type FinancialFilingRow,
} from "./financial-filing-item";

const loadMoreSchema = z.object({
  organisationId: z.uuid(),
  offset: z.number().int().nonnegative(),
});

export type LoadMoreFilingsResult =
  | { ok: true; filings: FinancialFilingRow[]; hasMore: boolean }
  | { ok: false; message: string };

/**
 * The Financial filings section's "Load more". A read, not a mutation, but it
 * lives in a "use server" file because this project has no API routes: the
 * client asks the page-colocated server for the next page of the same ordered
 * query page.tsx renders, so the section's ordering can never drift from the
 * first render.
 *
 * Authorisation mirrors the page's own gate (client:view), and RLS
 * (financial_periods_select_active) confines the read to every active user
 * exactly as it does for the initial page. Ordering is identical to page.tsx
 * — period_end desc with the id as a deterministic tiebreaker, so offset
 * pagination can never skip or duplicate a filing when two land in the same
 * financial year.
 */
export async function loadMoreFinancialFilings(input: unknown): Promise<LoadMoreFilingsResult> {
  const parsed = safeValidate(loadMoreSchema, input);
  if (!parsed.success) {
    return { ok: false, message: "That filing page could not be requested." };
  }

  const authorization = await getCurrentActor("client:view", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_periods")
    .select(
      "id, period_start, period_end, total_income, total_expenditure, income_band, filing_date, financial_source",
    )
    .eq("organisation_id", parsed.data.organisationId)
    .order("period_end", { ascending: false })
    .order("id", { ascending: true })
    .range(parsed.data.offset, parsed.data.offset + FINANCIAL_FILINGS_PAGE_SIZE - 1)
    .returns<FinancialFilingRow[]>();

  if (error) {
    await reportError(error, {
      operation: "clients.financial_filings_load_more",
      organisationId: parsed.data.organisationId,
    });
    return { ok: false, message: "More filings could not be loaded. Try again." };
  }

  return { ok: true, filings: data, hasMore: data.length === FINANCIAL_FILINGS_PAGE_SIZE };
}
