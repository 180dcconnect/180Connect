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
import { fillPartBFor } from "../../charity-register/annual-return-backfill.ts";
import { chunk } from "./charity-commission.ts";
import { reportRescoreFailure, rescoreOrganisation } from "../../scoring/rescore.ts";
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

/** Organisation ids per `in (...)` filter. Keeps the query string well inside
 *  what PostgREST accepts on a URL. */
const ID_FILTER_CHUNK = 200;

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
  /** Period rows the register filled in behind the API write. */
  partBFilled: number;
};

/** The columns loadTargets reads back for each stored period. */
type StoredPeriodRow = {
  organisation_id: string;
  period_end: string | null;
  income_donations_legacies: number | null;
  income_charitable_activities: number | null;
  income_govt_grants: number | null;
};

type CharityTarget = {
  organisationId: string;
  registeredNumber: string;
  /** Newest period_end already stored, or null when we hold nothing. */
  storedLatestEnd: string | null;
  /** How many periods we already hold, for the "history never ran" case. */
  storedCount: number;
  /** Whether any stored period carries the annual return's breakdown. */
  storedHasBreakdown: boolean;
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
  target: Pick<
    CharityTarget,
    "storedLatestEnd" | "storedCount" | "storedHasBreakdown"
  >,
  latest: CharityLatestFinancials | undefined,
  options?: {
    /**
     * Also re-fetch a charity whose stored periods carry no breakdown.
     *
     * Off for the weekly job and on for the one-off catch-up, deliberately: a
     * charity that files an entry-level return legitimately has no breakdown to
     * publish, and there is no column recording that we asked — so leaving this
     * on would spend one call a week, forever, on every totals-only filer in
     * the book. The catch-up script pays that cost once.
     */
    includeMissingBreakdown?: boolean;
  },
): boolean {
  const registerEnd = latest?.periodEnd ?? null;
  if (!registerEnd) return false;
  if (target.storedCount === 0) return true;
  if (target.storedCount === 1) return true;
  if (options?.includeMissingBreakdown && !target.storedHasBreakdown) return true;
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

  // Stored periods for these organisations, folded in memory: a per-organisation
  // aggregate would be one round trip per charity, and the whole table is a few
  // thousand rows. Read in id chunks — a single `in` list of a thousand uuids is
  // a ~40KB query string, and PostgREST answers that with a bare 400.
  const periods: StoredPeriodRow[] = [];
  for (const idChunk of chunk(
    rows.map((row) => row.organisation_id),
    ID_FILTER_CHUNK,
  )) {
    const { data, error: periodsError } = await supabase
      .from("financial_periods")
      .select(
        "organisation_id, period_end, income_donations_legacies, " +
          "income_charitable_activities, income_govt_grants",
      )
      .in("organisation_id", idChunk)
      // The select string is assembled rather than a single literal, and
      // supabase-js can only infer a row type from a literal — so the shape is
      // named here instead of coming out as GenericStringError.
      .returns<StoredPeriodRow[]>();
    if (periodsError) throw periodsError;
    periods.push(...(data ?? []));
  }

  const stored = new Map<
    string,
    { latestEnd: string | null; count: number; hasBreakdown: boolean }
  >();
  for (const period of periods) {
    const current = stored.get(period.organisation_id) ?? {
      latestEnd: null,
      count: 0,
      hasBreakdown: false,
    };
    const end = period.period_end ?? null;
    // Three of the fourteen breakdown columns are enough to tell whether this
    // row was written before the breakdown existed: any published split names
    // at least one of donations, charitable activities or government grants.
    const hasBreakdown =
      period.income_donations_legacies !== null ||
      period.income_charitable_activities !== null ||
      period.income_govt_grants !== null;
    stored.set(period.organisation_id, {
      latestEnd:
        end && (current.latestEnd === null || end > current.latestEnd)
          ? end
          : current.latestEnd,
      count: current.count + 1,
      hasBreakdown: current.hasBreakdown || hasBreakdown,
    });
  }

  return rows.map((row) => {
    const known = stored.get(row.organisation_id);
    return {
      organisationId: row.organisation_id,
      registeredNumber: row.identifier_value.trim(),
      storedLatestEnd: known?.latestEnd ?? null,
      storedCount: known?.count ?? 0,
      storedHasBreakdown: known?.hasBreakdown ?? false,
    };
  });
}

/**
 * Writes back what the register says about the charity itself, when it differs
 * from what we hold. Best-effort: a failure here must not cost the financial
 * rows, which are what the run is for.
 */
async function recordRegisterFacts(
  supabase: NonNullable<ReturnType<typeof buildAdminClient>>,
  target: CharityTarget,
  latest: CharityLatestFinancials | undefined,
): Promise<void> {
  if (!latest) return;
  const patch: { registered_on?: string; charity_reporting_status?: string } = {};
  if (latest.registeredOn) patch.registered_on = latest.registeredOn;
  if (latest.reportingStatus) patch.charity_reporting_status = latest.reportingStatus;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("organisations")
    .update(patch)
    .eq("id", target.organisationId);

  if (error) {
    await reportError(error, {
      operation: "ingestion.charity_commission.financial_refresh.register_facts",
      organisationId: target.organisationId,
    });
  }
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
  /** See needsHistory — on for the one-off catch-up, off for the weekly job. */
  includeMissingBreakdown?: boolean;
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

  // The charities this run actually wrote, so the Part B pass below asks the
  // register about those rather than re-walking the whole book every week.
  const written = new Set<string>();

  const result: FinancialRefreshResult = {
    checked: 0,
    historyFetched: 0,
    organisationsWritten: 0,
    periodsWritten: 0,
    budgetExhausted: false,
    partBFilled: 0,
  };
  if (targets.length === 0) return result;

  const latestByNumber = await fetchLatestFinancials(
    targets.map((target) => target.registeredNumber),
    headers,
  );
  result.checked = targets.length;

  for (const target of targets) {
    const latest = latestByNumber.get(target.registeredNumber);

    // Registration date and reporting status are written for every charity the
    // details sweep answered for, whether or not it turns out to have accounts.
    // The charities with nothing to fetch are exactly the ones the UI needs
    // these two facts for: without them an eight-month-old charity and a
    // charity three years overdue are the same empty Financials tab.
    await recordRegisterFacts(supabase, target, latest);

    if (
      !needsHistory(target, latest, {
        includeMissingBreakdown: options?.includeMissingBreakdown,
      })
    ) {
      continue;
    }

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
        // The annual return's own split. Nulls are "not published for this
        // year", which is the common case for a smaller charity filing an
        // entry-level return — see the migration header on
        // 20260922093000_add_charity_financial_breakdown.sql.
        income_donations_legacies: period.incomeDonationsLegacies,
        income_charitable_activities: period.incomeCharitableActivities,
        income_other_trading: period.incomeOtherTrading,
        income_investment: period.incomeInvestment,
        income_endowments: period.incomeEndowments,
        income_other: period.incomeOther,
        income_govt_grants: period.incomeGovtGrants,
        income_govt_contracts: period.incomeGovtContracts,
        expenditure_charitable_activities: period.expenditureCharitableActivities,
        expenditure_raising_funds: period.expenditureRaisingFunds,
        expenditure_governance: period.expenditureGovernance,
        expenditure_grants_institutions: period.expenditureGrantsInstitutions,
        expenditure_investment_management: period.expenditureInvestmentManagement,
        expenditure_other: period.expenditureOther,
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
    written.add(target.organisationId);

    // A newly filed year can move the charity into a different income band, and
    // the size factor is the one input carrying real spread across the book —
    // so a refresh that does not rescore leaves the queue ordered on last
    // year's accounts. Best-effort, same contract as every other rescore site:
    // the score is recoverable by the next sweep, the filings are not.
    await reportRescoreFailure(
      await rescoreOrganisation(target.organisationId),
      "ingestion.charity_commission.financial_refresh.rescore",
      target.organisationId,
    );
  }

  // The half of the annual return this endpoint does not publish, taken off the
  // register file that already ships with the deployment. Doing it here rather
  // than leaving it to the button is what keeps a newly filed year from arriving
  // with a blank headcount and staying that way — see `fillPartBFor`.
  //
  // Swallowed rather than reported as a run failure: the refresh has already
  // written what it came for, and a deployment with no register file (or one
  // built by an older commit) must not turn that into a failed job.
  try {
    const filled = await fillPartBFor(supabase, written);
    result.partBFilled = filled.periods;
  } catch (error) {
    await reportError(error, {
      operation: "ingestion.charity_commission.financial_refresh.part_b",
    });
  }

  return result;
}
