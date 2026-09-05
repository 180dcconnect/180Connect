// Turning Charity Commission financial data into FINANCIAL_PERIODS rows.
//
// Pure, and separate from the fetching, for the reason every other
// standardize/* split exists: the interesting decisions here are about dates
// and duplicates, and they should be testable without a network or a database.

import { deriveIncomeBand, type IncomeBand } from "../income-band.ts";
import type {
  CharityFinancialHistoryItem,
  CharityLatestFinancials,
} from "../ingestion/sources/charity-commission-financials.ts";

/**
 * The breakdown, carried through untouched.
 *
 * Nothing here is summed, reconciled against the totals, or defaulted to zero:
 * a smaller charity files an entry-level return with totals only, so a null is
 * "the register published no figure for this", and a zero would be a claim the
 * data does not make. `total_income` / `total_expenditure` stay the
 * authoritative pair — these are what those two are *made of*, where the
 * register says so.
 */
export type FinancialBreakdown = {
  incomeDonationsLegacies: number | null;
  incomeCharitableActivities: number | null;
  incomeOtherTrading: number | null;
  incomeInvestment: number | null;
  incomeEndowments: number | null;
  incomeOther: number | null;
  incomeGovtGrants: number | null;
  incomeGovtContracts: number | null;
  expenditureCharitableActivities: number | null;
  expenditureRaisingFunds: number | null;
  expenditureGovernance: number | null;
  expenditureGrantsInstitutions: number | null;
  expenditureInvestmentManagement: number | null;
  expenditureOther: number | null;
};

export const EMPTY_BREAKDOWN: FinancialBreakdown = {
  incomeDonationsLegacies: null,
  incomeCharitableActivities: null,
  incomeOtherTrading: null,
  incomeInvestment: null,
  incomeEndowments: null,
  incomeOther: null,
  incomeGovtGrants: null,
  incomeGovtContracts: null,
  expenditureCharitableActivities: null,
  expenditureRaisingFunds: null,
  expenditureGovernance: null,
  expenditureGrantsInstitutions: null,
  expenditureInvestmentManagement: null,
  expenditureOther: null,
};

/** The breakdown half of an already-built row. */
function breakdownFrom(row: FinancialBreakdown): FinancialBreakdown {
  const {
    incomeDonationsLegacies,
    incomeCharitableActivities,
    incomeOtherTrading,
    incomeInvestment,
    incomeEndowments,
    incomeOther,
    incomeGovtGrants,
    incomeGovtContracts,
    expenditureCharitableActivities,
    expenditureRaisingFunds,
    expenditureGovernance,
    expenditureGrantsInstitutions,
    expenditureInvestmentManagement,
    expenditureOther,
  } = row;
  return {
    incomeDonationsLegacies,
    incomeCharitableActivities,
    incomeOtherTrading,
    incomeInvestment,
    incomeEndowments,
    incomeOther,
    incomeGovtGrants,
    incomeGovtContracts,
    expenditureCharitableActivities,
    expenditureRaisingFunds,
    expenditureGovernance,
    expenditureGrantsInstitutions,
    expenditureInvestmentManagement,
    expenditureOther,
  };
}

function breakdownOf(row: CharityFinancialHistoryItem): FinancialBreakdown {
  return {
    incomeDonationsLegacies: row.incomeDonationsLegacies,
    incomeCharitableActivities: row.incomeCharitableActivities,
    incomeOtherTrading: row.incomeOtherTrading,
    incomeInvestment: row.incomeInvestment,
    incomeEndowments: row.incomeEndowments,
    incomeOther: row.incomeOther,
    incomeGovtGrants: row.incomeGovtGrants,
    incomeGovtContracts: row.incomeGovtContracts,
    expenditureCharitableActivities: row.expenditureCharitableActivities,
    expenditureRaisingFunds: row.expenditureRaisingFunds,
    expenditureGovernance: row.expenditureGovernance,
    expenditureGrantsInstitutions: row.expenditureGrantsInstitutions,
    expenditureInvestmentManagement: row.expenditureInvestmentManagement,
    expenditureOther: row.expenditureOther,
  };
}

export type FinancialPeriodRow = {
  periodStart: string;
  periodEnd: string;
  totalIncome: number | null;
  totalExpenditure: number | null;
  incomeBand: IncomeBand | null;
} & FinancialBreakdown;

const DAY_MS = 86_400_000;

function parse(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A period start for a history row, which the API does not give us.
 *
 * `charityfinancialhistory` reports only `financial_period_end_date`, but
 * FINANCIAL_PERIODS.period_start is NOT NULL and the table's unique index is
 * keyed on it — so a start has to come from somewhere, and where it comes from
 * decides whether a re-run writes the same row again or a duplicate.
 *
 * In order of authority:
 *
 * 1. The previous year's end date + one day. This is not a guess: consecutive
 *    annual returns tile the calendar, so it reproduces the authoritative start
 *    exactly (verified against Oxfam, whose 2024-04-01 start is 2024-03-31 + 1),
 *    and it stays correct through a changed year-end, which is precisely the
 *    case a fixed twelve-month subtraction gets wrong.
 * 2. Failing that (the oldest row, or a gap so large the years plainly do not
 *    tile), end minus one year plus a day — the ordinary twelve-month year.
 *
 * The gap guard is 18 months: two returns further apart than that are not
 * consecutive periods, they are a filing gap with a missing year in between,
 * and tiling across it would invent an 18-month accounting period.
 */
const MAX_TILING_GAP_MS = 550 * DAY_MS;

function startFromPreviousEnd(
  periodEnd: string,
  previousEnd: string | null,
): string {
  const end = parse(periodEnd);
  if (previousEnd) {
    const previous = parse(previousEnd);
    if (end > previous && end - previous <= MAX_TILING_GAP_MS) {
      return toISODate(previous + DAY_MS);
    }
  }
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return toISODate(start.getTime() + DAY_MS);
}

/**
 * Every filed period we can record for one charity, oldest first.
 *
 * Two sources, deliberately merged rather than picked between: the history
 * endpoint has the years, the details endpoint has the authoritative start date
 * for the most recent one. Where they describe the same period end, the
 * details row wins on dates and the history row fills in any figure it is
 * missing — a period end is the same fact from both, but a *derived* start
 * competing with a published one is how the unique index
 * (organisation_id, period_start, period_end, financial_source) ends up holding
 * the same year twice.
 *
 * A period with no figures at all is dropped: the row would assert that a
 * charity filed accounts saying nothing, and the scorer would then have to
 * distinguish "filed, empty" from "not filed", which nothing downstream does.
 */
export function buildFinancialPeriods(input: {
  history: readonly CharityFinancialHistoryItem[];
  latest?: CharityLatestFinancials | null;
}): FinancialPeriodRow[] {
  const { history, latest } = input;

  // Oldest first, and only rows that name a period end — a return with no end
  // date cannot be placed on the timeline, let alone tiled against.
  const ordered = [...history]
    .filter((row) => row.financial_period_end_date !== null)
    .sort((a, b) =>
      (a.financial_period_end_date ?? "").localeCompare(
        b.financial_period_end_date ?? "",
      ),
    );

  const byEnd = new Map<string, FinancialPeriodRow>();
  let previousEnd: string | null = null;

  for (const row of ordered) {
    const periodEnd = row.financial_period_end_date!;
    // A duplicated end date (two returns for one year) keeps the first: the
    // second carries the same period and would only differ by restatement,
    // which the caller's upsert handles rather than a second row.
    if (byEnd.has(periodEnd)) continue;
    if (row.income === null && row.expenditure === null) {
      previousEnd = periodEnd;
      continue;
    }
    byEnd.set(periodEnd, {
      periodStart: startFromPreviousEnd(periodEnd, previousEnd),
      periodEnd,
      totalIncome: row.income,
      totalExpenditure: row.expenditure,
      incomeBand: deriveIncomeBand(row.income),
      ...breakdownOf(row),
    });
    previousEnd = periodEnd;
  }

  if (latest?.periodEnd && latest.periodStart) {
    const existing = byEnd.get(latest.periodEnd);
    const totalIncome = latest.totalIncome ?? existing?.totalIncome ?? null;
    const totalExpenditure =
      latest.totalExpenditure ?? existing?.totalExpenditure ?? null;
    if (totalIncome !== null || totalExpenditure !== null) {
      byEnd.set(latest.periodEnd, {
        periodStart: latest.periodStart,
        periodEnd: latest.periodEnd,
        totalIncome,
        totalExpenditure,
        incomeBand: deriveIncomeBand(totalIncome),
        // `charitydetailsmulti` publishes no breakdown at all, so the details
        // row wins on dates and totals while the history row it replaces keeps
        // its parts — dropping them here would mean the most recent year, the
        // one anybody actually reads, is the only year with no split.
        ...(existing ? breakdownFrom(existing) : EMPTY_BREAKDOWN),
      });
    }
  }

  return [...byEnd.values()]
    .filter((row) => row.periodEnd >= row.periodStart)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

// ---------------------------------------------------------------------------
// The bulk register extract's annual returns
// ---------------------------------------------------------------------------

/**
 * One merged Part A + Part B annual return, as the bulk extract publishes it.
 *
 * Deliberately `Record<string, unknown>`-shaped at the edge: the two extracts
 * carry eighty-odd fields between them and this module reads eleven. Typing the
 * rest would be documentation pretending to be a contract.
 */
export type BulkAnnualReturn = Record<string, unknown>;

/**
 * The register's field names differ between the API and the bulk extract for
 * the same figures — `inc_donations_and_legacies` against
 * `income_donations_and_legacies`, `exp_grants_institution` against
 * `expenditure_grants_institution`. A table rather than inline reads, because
 * the failure mode of a mistyped key here is a column that is silently always
 * null, which no test of the happy path would catch.
 */
const BULK_BREAKDOWN_FIELDS: Record<keyof FinancialBreakdown, string> = {
  incomeDonationsLegacies: "income_donations_and_legacies",
  incomeCharitableActivities: "income_charitable_activities",
  incomeOtherTrading: "income_other_trading_activities",
  incomeInvestment: "income_investments",
  incomeEndowments: "income_endowments",
  incomeOther: "income_other",
  incomeGovtGrants: "income_from_government_grants",
  incomeGovtContracts: "income_from_government_contracts",
  expenditureCharitableActivities: "expenditure_charitable_expenditure",
  expenditureRaisingFunds: "expenditure_raising_funds",
  expenditureGovernance: "expenditure_governance",
  expenditureGrantsInstitutions: "expenditure_grants_institution",
  expenditureInvestmentManagement: "expenditure_investment_management",
  expenditureOther: "expenditure_other",
};

/** Scale and public-funding shape, the fields beyond the money itself. */
export type BulkPeriodExtras = {
  filingDate: string | null;
  countEmployees: number | null;
  countVolunteers: number | null;
  receivesGovtGrants: boolean | null;
  receivesGovtContracts: boolean | null;
  countGovtGrants: number | null;
  countGovtContracts: number | null;
};

export type BulkFinancialPeriodRow = FinancialPeriodRow & BulkPeriodExtras;

function numberAt(row: BulkAnnualReturn, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A filed yes/no, from either shape the extract reaches us in.
 *
 * The daily extract publishes real JSON booleans. The register file does not:
 * SQLite has no boolean type, so `scripts/build-register-sqlite.mts` stores
 * these as INTEGER and `node:sqlite` reads them back as 0 and 1 — all 513,910
 * of them. Accepting only `boolean` therefore turned every government-funding
 * flag that came through the register file into a null, silently, on the import
 * path as well as the backfill. Anything else — a string, undefined, a missing
 * key — is still "not published", because that is what it is.
 */
function booleanAt(row: BulkAnnualReturn, key: string): boolean | null {
  const value = row[key];
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  return null;
}

function dateAt(row: BulkAnnualReturn, key: string): string | null {
  const value = row[key];
  if (typeof value !== "string" || !value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Filed periods from the bulk extract's annual returns.
 *
 * Simpler than the API path in one important way and richer in two others:
 *
 * - **No date derivation.** The extract publishes `fin_period_start_date` as
 *   well as the end, so nothing has to tile consecutive years to invent a
 *   start. Rows without both dates are dropped rather than guessed at.
 * - **A real filing date.** `ar_received_date` is when the Commission received
 *   the return. FINANCIAL_PERIODS.filing_date has been null since the table was
 *   created because no API endpoint publishes it — this is the only source we
 *   have for it, and it turns the staleness signal from inferred to exact.
 * - **Scale and public funding.** Employees, volunteers, and whether the
 *   government money is a standing relationship or a one-off.
 *
 * Same two rules as the API path: a period with no figures at all is dropped,
 * and a null part stays null rather than becoming a zero the register never
 * claimed.
 */
export function buildFinancialPeriodsFromBulk(
  returns: readonly BulkAnnualReturn[],
): BulkFinancialPeriodRow[] {
  const byEnd = new Map<string, BulkFinancialPeriodRow>();

  for (const row of returns) {
    const periodStart = dateAt(row, "fin_period_start_date");
    const periodEnd = dateAt(row, "fin_period_end_date");
    if (!periodStart || !periodEnd || periodEnd < periodStart) continue;

    // Part B's expenditure_total is the fuller figure where both are filed;
    // Part A's totals are what a smaller charity files instead.
    const totalIncome =
      numberAt(row, "income_total_income_and_endowments") ??
      numberAt(row, "total_gross_income");
    const totalExpenditure =
      numberAt(row, "expenditure_total") ?? numberAt(row, "total_gross_expenditure");
    if (totalIncome === null && totalExpenditure === null) continue;

    const breakdown = {} as FinancialBreakdown;
    for (const [field, key] of Object.entries(BULK_BREAKDOWN_FIELDS) as [
      keyof FinancialBreakdown,
      string,
    ][]) {
      breakdown[field] = numberAt(row, key);
    }

    // A duplicated period end keeps the first: the extracts are keyed on
    // (charity, period), so a second row for one year is a restatement, which
    // the caller's upsert handles rather than a second row.
    if (byEnd.has(periodEnd)) continue;

    byEnd.set(periodEnd, {
      periodStart,
      periodEnd,
      totalIncome,
      totalExpenditure,
      incomeBand: deriveIncomeBand(totalIncome),
      ...breakdown,
      filingDate: dateAt(row, "ar_received_date"),
      countEmployees: numberAt(row, "count_employees"),
      countVolunteers: numberAt(row, "count_volunteers"),
      receivesGovtGrants: booleanAt(row, "charity_receives_govt_funding_grants"),
      receivesGovtContracts: booleanAt(row, "charity_receives_govt_funding_contracts"),
      countGovtGrants: numberAt(row, "count_govt_grants"),
      countGovtContracts: numberAt(row, "count_govt_contracts"),
    });
  }

  return [...byEnd.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}
