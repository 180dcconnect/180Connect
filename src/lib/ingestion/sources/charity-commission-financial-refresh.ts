// Charity Commission financial refresh — the job that keeps FINANCIAL_PERIODS
// filled, and the answer to why the table was empty in the first place.
//
// Discovery (charity-commission.ts) searches *forward from a registration
// watermark*: it finds charities registered since the last run, which is the
// one cohort guaranteed to have filed no accounts yet. That is why 774 Charity
// Commission raw records carried the `latest_income` key and five carried a
// value. Nothing was broken — we were asking the right API about the wrong
// charities.
//
// This job asks about the charities we already hold, and it is built around the
// cost difference between the two endpoints:
//
//   - `charitydetailsmulti` takes 30 charity numbers per call, so the whole
//     book costs ~40 calls. It reports each charity's latest filed year.
//   - `charityfinancialhistory` takes one charity per call and returns five
//     years.
//
// So the cheap call is the *signal*: fetch every charity's latest period end,
// compare it to the newest period already stored, and spend a history call only
// where the register has moved on (or where we hold nothing at all). After the
// first sweep that is a handful of charities a week rather than a thousand,
// and a charity too new to have filed anything costs nothing at all — it has no
// latest period end, so it never triggers the expensive call.
//
// The budget is what makes this safe to schedule: a run stops issuing history
// calls once it has spent HISTORY_CALL_BUDGET of them, and the next run picks up
// exactly where this one stopped, because "needs history" is derived from the
// data rather than from a cursor column nobody has approved on the Data Model.

import { buildAdminClient } from "../../supabase/admin-client-factory.ts";
import { reportError } from "../../error-logging.ts";
import { buildFinancialPeriods } from "../../financials/charity-financial-periods.ts";
import {
  charityCommissionHeaders,
  fetchFinancialHistory,
  fetchLatestFinancials,
  type CharityLatestFinancials,
} from "./charity-commission-financials.ts";

/**
 * History calls per run. 250 × ~0.4s is comfortably inside the cron route's
 * 300s ceiling with the details sweep in front of it; the first backfill runs
 * are the only ones that ever hit it.
 */
export const HISTORY_CALL_BUDGET = 250;

/** Pause between history calls — one charity at a time, deliberately. The
 *  register is a public service and this job has nothing to gain from speed. */
const HISTORY_CALL_DELAY_MS = 120;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type FinancialRefreshResult = {
  /** Charities whose latest year we asked about. */
  checked: number;
  /** Charities we spent a history call on. */
  historyFetched: number;
  /** Charities that gained or updated at least one period row. */
  organisationsWritten: number;
  /** Period rows written or refreshed. */
  periodsWritten: number;
  /** True when the budget stopped the run early — there is more to do. */
  budgetExhausted: boolean;
};

type CharityTarget = {
  organisationId: string;
  registeredNumber: string;
  /** Newest period_end already stored, or null when we hold nothing. */
  storedLatestEnd: string | null;
  /** How many periods we already hold, for the "history never ran" case. */
  storedCount: number;
};

/**
 * Whether a charity is worth a history call.
 *
 * Three cases, and only three: we hold nothing and the register has something;
 * the register's latest year is newer than ours; or we hold exactly one period,
 * which is the signature of a record written by the old promote-time path that
 * only ever saw `latest_income` — the other four years are still out there.
 */
export function needsHistory(
  target: Pick<CharityTarget, "storedLatestEnd" | "storedCount">,
  latest: CharityLatestFinancials | undefined,
): boolean {
  const registerEnd = latest?.periodEnd ?? null;
  if (!registerEnd) return false;
  if (target.storedCount === 0) return true;
  if (target.storedCount === 1) return true;
  return target.storedLatestEnd === null || registerEnd > target.storedLatestEnd;
}

/**
 * Every charity we hold a registration number for, with what we already know
 * about its filings.
 *
 * `uk_charity` is the identifier type the Charity Commission promote path
 * writes (organisation_identifiers), so it is also the only set this API can
 * answer for.
 */
async function loadTargets(
  supabase: NonNullable<ReturnType<typeof buildAdminClient>>,
  limit: number,
): Promise<CharityTarget[]> {
  const { data: identifiers, error } = await supabase
    .from("organisation_identifiers")
    .select("organisation_id, identifier_value")
    .eq("identifier_type", "uk_charity")
    .limit(limit);
  if (error) throw error;

  const rows = (identifiers ?? []).filter(
    (row): row is { organisation_id: string; identifier_value: string } =>
      Boolean(row.organisation_id && row.identifier_value),
  );
  if (rows.length === 0) return [];

  // One read of every stored period for these organisations, folded in memory:
  // a per-organisation aggregate would be one round trip per charity, and the
  // whole table is a few thousand rows.
  const { data: periods, error: periodsError } = await supabase
    .from("financial_periods")
    .select("organisation_id, period_end")
    .in(
      "organisation_id",
      rows.map((row) => row.organisation_id),
    );
  if (periodsError) throw periodsError;

  const stored = new Map<string, { latestEnd: string | null; count: number }>();
  for (const period of periods ?? []) {
    const current = stored.get(period.organisation_id) ?? {
      latestEnd: null,
      count: 0,
    };
    const end = period.period_end ?? null;
    stored.set(period.organisation_id, {
      latestEnd:
        end && (current.latestEnd === null || end > current.latestEnd)
          ? end
          : current.latestEnd,
      count: current.count + 1,
    });
  }

  return rows.map((row) => {
    const known = stored.get(row.organisation_id);
    return {
      organisationId: row.organisation_id,
      registeredNumber: row.identifier_value.trim(),
      storedLatestEnd: known?.latestEnd ?? null,
      storedCount: known?.count ?? 0,
    };
  });
}

/**
 * Refreshes filed accounts for the charities we hold.
 *
 * Idempotent by construction: every write goes through the
 * (organisation_id, period_start, period_end, financial_source) unique index,
 * updating the figures on conflict rather than inserting a second row — which
 * is also how a restated set of accounts lands correctly.
 */
export async function runCharityCommissionFinancialRefresh(options?: {
  /** Cap on charities considered, for scripts that want to walk in slices. */
  limit?: number;
  historyBudget?: number;
}): Promise<FinancialRefreshResult> {
  const supabase = buildAdminClient();
  if (!supabase) {
    throw new Error(
      "Supabase admin client is not configured — check SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const historyBudget = options?.historyBudget ?? HISTORY_CALL_BUDGET;
  const headers = charityCommissionHeaders();
  const targets = await loadTargets(supabase, options?.limit ?? 5_000);

  const result: FinancialRefreshResult = {
    checked: 0,
    historyFetched: 0,
    organisationsWritten: 0,
    periodsWritten: 0,
    budgetExhausted: false,
  };
  if (targets.length === 0) return result;

  const latestByNumber = await fetchLatestFinancials(
    targets.map((target) => target.registeredNumber),
    headers,
  );
  result.checked = targets.length;

  for (const target of targets) {
    const latest = latestByNumber.get(target.registeredNumber);
    if (!needsHistory(target, latest)) continue;

    if (result.historyFetched >= historyBudget) {
      result.budgetExhausted = true;
      break;
    }

    let history: Awaited<ReturnType<typeof fetchFinancialHistory>> = [];
    try {
      history = await fetchFinancialHistory(target.registeredNumber, headers);
      result.historyFetched += 1;
    } catch (error) {
      // One charity's history failing is not the run failing: the next
      // scheduled run reconsiders it, because what it needs is still derived
      // from what is stored.
      await reportError(error, {
        operation: "ingestion.charity_commission.financial_refresh.history",
        organisationId: target.organisationId,
      });
      result.historyFetched += 1;
      continue;
    } finally {
      await sleep(HISTORY_CALL_DELAY_MS);
    }

    const periods = buildFinancialPeriods({ history, latest });
    if (periods.length === 0) continue;

    const { error: writeError } = await supabase.from("financial_periods").upsert(
      periods.map((period) => ({
        organisation_id: target.organisationId,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        total_income: period.totalIncome,
        total_expenditure: period.totalExpenditure,
        income_band: period.incomeBand,
        financial_source: "charity_commission" as const,
      })),
      {
        onConflict:
          "organisation_id,period_start,period_end,financial_source",
      },
    );

    if (writeError) {
      await reportError(writeError, {
        operation: "ingestion.charity_commission.financial_refresh.write",
        organisationId: target.organisationId,
      });
      continue;
    }

    result.organisationsWritten += 1;
    result.periodsWritten += periods.length;
  }

  return result;
}
