// The Financials tab's chart data, built once and shared by every mark on it.
//
// Pure and testable, and deliberately not inside the chart component: the
// awkward decisions here are about *money and dates*, not about pixels — which
// grant belongs to which filed year, what counts as a comparable currency, and
// what a share of income means when the denominator is missing.

import { deriveIncomeBand, type IncomeBand } from "../income-band.ts";

export type FinancialPeriodInput = {
  period_start: string;
  period_end: string;
  total_income: number | null;
  total_expenditure: number | null;
  income_band?: string | null;
  /** The annual return's own split, where the register published one. */
  income_donations_legacies?: number | null;
  income_charitable_activities?: number | null;
  income_other_trading?: number | null;
  income_investment?: number | null;
  income_endowments?: number | null;
  income_other?: number | null;
  income_govt_grants?: number | null;
  income_govt_contracts?: number | null;
};

export type GrantInput = {
  amount_awarded: number | null;
  currency: string | null;
  award_date: string | null;
};

export type FinancialYear = {
  /** "FY24" — the year the period *ends* in, which is how accounts are named. */
  label: string;
  periodStart: string;
  periodEnd: string;
  income: number | null;
  expenditure: number | null;
  /** income − expenditure, or null when either side is missing. */
  net: number | null;
  incomeBand: IncomeBand | null;
  /** Matched 360Giving awards dated inside this period, in GBP. */
  grantTotal: number;
  /** Awards inside the period that were not in GBP, so could not be summed. */
  grantsExcluded: number;
  /** grantTotal / income, or null when income is missing or zero. */
  grantShare: number | null;
  /** Where the income came from, largest first — only the parts published. */
  mix: IncomeSource[];
  /** Government grants + contracts, or null when neither was published. */
  governmentIncome: number | null;
  /** governmentIncome / income, or null when either side is unknown. */
  governmentShare: number | null;
};

/** One published income source for a year. */
export type IncomeSource = {
  label: string;
  amount: number;
  /** True for the two government lines, which the UI pulls out separately. */
  government: boolean;
};

export type FinancialSeries = {
  years: FinancialYear[];
  /** Largest income or expenditure figure across the series — the y-scale. */
  peak: number;
  /** Largest surplus or deficit magnitude — the diverging panel's half-scale. */
  peakNet: number;
  hasIncome: boolean;
  hasExpenditure: boolean;
  hasGrants: boolean;
  /** True when any year published an income split. */
  hasMix: boolean;
  /** True when any period had a non-GBP award we left out of the share. */
  hasExcludedGrants: boolean;
};

/** Awards are summed only where the currency matches the accounts. A USD award
 *  is real money, but adding it to a sterling income line would be arithmetic
 *  on two different units — it is counted as excluded and said out loud. */
const ACCOUNTS_CURRENCY = "GBP";

/**
 * The register's income lines, in the words a reader would use.
 *
 * Order here is only a fallback for ties — the UI sorts by amount, because the
 * question is "where does their money come from" and the answer is whichever
 * line is biggest, not whichever the annual return prints first.
 *
 * `inc_legacies` is deliberately absent: the register reports it *inside*
 * donations and legacies, so showing both would double-count the same money.
 */
const INCOME_SOURCE_LABELS: {
  key: keyof FinancialPeriodInput;
  label: string;
  government: boolean;
}[] = [
  { key: "income_donations_legacies", label: "Donations and legacies", government: false },
  { key: "income_charitable_activities", label: "Charitable activities", government: false },
  { key: "income_other_trading", label: "Other trading", government: false },
  { key: "income_investment", label: "Investments", government: false },
  { key: "income_endowments", label: "Endowments", government: false },
  { key: "income_other", label: "Other income", government: false },
  { key: "income_govt_grants", label: "Government grants", government: true },
  { key: "income_govt_contracts", label: "Government contracts", government: true },
];

/**
 * The published parts of a year's income, largest first.
 *
 * A null part is dropped rather than shown as zero: a smaller charity files an
 * entry-level return with totals only, and "£0 from investments" is a claim the
 * register did not make. A part published *as* zero is kept — that is a real
 * filing saying "none".
 *
 * The parts are not reconciled against total_income and no remainder is
 * invented. Where the register publishes a partial split the parts genuinely do
 * not add up, and manufacturing an "Other" bucket to close the gap would be the
 * UI asserting arithmetic the source does not support.
 */
function incomeMix(period: FinancialPeriodInput): IncomeSource[] {
  const sources: IncomeSource[] = [];
  for (const { key, label, government } of INCOME_SOURCE_LABELS) {
    const value = period[key];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    if (value === 0) continue;
    sources.push({ label, amount: value, government });
  }
  return sources.sort((a, b) => b.amount - a.amount);
}

/** Grants plus contracts — null only when the register published neither. */
function governmentTotal(period: FinancialPeriodInput): number | null {
  const grants = period.income_govt_grants;
  const contracts = period.income_govt_contracts;
  if (typeof grants !== "number" && typeof contracts !== "number") return null;
  return (typeof grants === "number" ? grants : 0) +
    (typeof contracts === "number" ? contracts : 0);
}

function financialYearLabel(periodEnd: string): string {
  const year = periodEnd.slice(0, 4);
  return `FY${year.slice(-2)}`;
}

/**
 * Chart-ready years, oldest first.
 *
 * Grants are placed by award date inside the filed period. That is a real
 * approximation and the UI says so: 360Giving publishes the date an award was
 * *made*, and a three-year grant lands entirely in the year it was announced —
 * so the share is "how much new grant funding was won against that year's
 * income", not "what proportion of that year's income came from grants". The
 * honest framing is the one the label uses.
 */
export function buildFinancialSeries(input: {
  periods: readonly FinancialPeriodInput[];
  grants: readonly GrantInput[];
}): FinancialSeries {
  const years = [...input.periods]
    .filter((period) => period.period_start && period.period_end)
    .sort((a, b) => a.period_end.localeCompare(b.period_end))
    .map((period): FinancialYear => {
      const income = period.total_income;
      const expenditure = period.total_expenditure;

      let grantTotal = 0;
      let grantsExcluded = 0;
      for (const grant of input.grants) {
        const awardDate = grant.award_date?.slice(0, 10);
        if (!awardDate) continue;
        if (awardDate < period.period_start || awardDate > period.period_end) continue;
        if (grant.amount_awarded === null) continue;
        if ((grant.currency ?? ACCOUNTS_CURRENCY).toUpperCase() !== ACCOUNTS_CURRENCY) {
          grantsExcluded += 1;
          continue;
        }
        grantTotal += grant.amount_awarded;
      }

      const mix = incomeMix(period);
      const government = governmentTotal(period);

      return {
        label: financialYearLabel(period.period_end),
        periodStart: period.period_start,
        periodEnd: period.period_end,
        income,
        expenditure,
        net: income !== null && expenditure !== null ? income - expenditure : null,
        incomeBand:
          (period.income_band as IncomeBand | null) ?? deriveIncomeBand(income),
        grantTotal,
        grantsExcluded,
        // A share of nothing is not zero, it is unknown — and a share over 1
        // is left as it is rather than clamped, because a year where new
        // awards exceeded income is a fact worth seeing, not a rendering bug.
        grantShare:
          income !== null && income > 0 ? grantTotal / income : null,
        mix,
        governmentIncome: government,
        governmentShare:
          government !== null && income !== null && income > 0
            ? government / income
            : null,
      };
    });

  const peak = years.reduce(
    (max, year) => Math.max(max, year.income ?? 0, year.expenditure ?? 0),
    0,
  );
  const peakNet = years.reduce(
    (max, year) => Math.max(max, Math.abs(year.net ?? 0)),
    0,
  );

  return {
    years,
    peak,
    peakNet,
    hasIncome: years.some((year) => year.income !== null),
    hasExpenditure: years.some((year) => year.expenditure !== null),
    hasGrants: years.some((year) => year.grantTotal > 0),
    hasMix: years.some((year) => year.mix.length > 0),
    hasExcludedGrants: years.some((year) => year.grantsExcluded > 0),
  };
}

export type FilingRecency = {
  /** Whole months between the period end and now. */
  monthsOld: number;
  /** Past the point where the register would expect newer accounts. */
  stale: boolean;
  /** "Filed for the year ended 31 Mar 2025" style age, in words. */
  label: string;
};

/**
 * How old the newest filed accounts are.
 *
 * Charities have ten months from their year end to file, so accounts up to
 * about 22 months old are simply the newest that exist. Past that, either the
 * charity is late with the register or our copy is behind — either way the
 * income figure on this record is describing a year that ended nearly two years
 * ago, and anything reading it (the size score, the client-list filter, a CAM
 * sizing an approach) is working from stale evidence and should be told.
 *
 * FINANCIAL_PERIODS.filing_date would be the better input and stays null: the
 * Charity Commission API publishes no accounts-submission date at any endpoint
 * (see charity-commission-financials.ts), so age is measured from the period
 * end, which every filing has.
 */
export const STALE_AFTER_MONTHS = 22;

export function filingRecency(
  periodEnd: string | null | undefined,
  now: Date = new Date(),
): FilingRecency | null {
  if (!periodEnd) return null;
  const end = Date.parse(`${periodEnd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end)) return null;

  const months = Math.max(
    0,
    Math.floor((now.getTime() - end) / (30.44 * 86_400_000)),
  );

  const label =
    months < 1
      ? "Filed for a year that has just ended"
      : months < 12
        ? `Covers a year that ended ${months} month${months === 1 ? "" : "s"} ago`
        : `Covers a year that ended ${Math.floor(months / 12)} year${
            months >= 24 ? "s" : ""
          } ago`;

  return { monthsOld: months, stale: months > STALE_AFTER_MONTHS, label };
}

// ---------------------------------------------------------------------------
// Why a charity has no filed accounts
// ---------------------------------------------------------------------------

/**
 * A charity gets twelve months to reach its first financial year end and ten
 * more to file — so nothing is expected of a newly registered charity for the
 * best part of two years. `21` rather than `22` here on purpose: this window is
 * measured from *registration*, while STALE_AFTER_MONTHS measures from a year
 * end that has already passed.
 */
export const FIRST_ACCOUNTS_GRACE_MONTHS = 22;

export type MissingAccountsReason =
  /** Registered too recently for a first return to be due. */
  | { kind: "too_new"; monthsRegistered: number; dueFrom: string | null }
  /** Long enough registered that a return should exist, and none does. */
  | { kind: "nothing_filed"; monthsRegistered: number }
  /** No registration date held, so we cannot say which of the two it is. */
  | { kind: "unknown" };

/**
 * Why the Financials tab is empty — the honest version, per client.
 *
 * This exists because an empty tab was indistinguishable from a broken one, and
 * it was overwhelmingly *neither*: discovery searches the register forward from
 * a registration watermark, so it imports charities registered since the last
 * run — 769 of 774 Charity Commission records on staging were registered inside
 * two years, and a charity that young has filed nothing because nothing is due.
 * The register is not withholding anything and the pipeline is not failing;
 * there is simply no annual return in existence yet.
 *
 * `reportingStatus` is the register's own word and outranks the arithmetic when
 * it says "New": the Commission knows better than a date subtraction whether it
 * is waiting on a first return.
 *
 * Returns null when there is nothing to explain — periods exist, or this is not
 * a charity and so was never going to have a Charity Commission filing.
 */
export function explainMissingAccounts(input: {
  periodCount: number;
  /** Whether we hold a Charity Commission number for this organisation. */
  isCharityRegistered: boolean;
  registeredOn: string | null | undefined;
  reportingStatus: string | null | undefined;
  now?: Date;
}): MissingAccountsReason | null {
  if (input.periodCount > 0) return null;
  if (!input.isCharityRegistered) return null;

  const now = input.now ?? new Date();
  const registered = input.registeredOn
    ? Date.parse(`${input.registeredOn.slice(0, 10)}T00:00:00Z`)
    : NaN;

  if (Number.isNaN(registered)) {
    // The register's own status can still carry the answer without a date.
    return input.reportingStatus?.toLowerCase() === "new"
      ? { kind: "too_new", monthsRegistered: 0, dueFrom: null }
      : { kind: "unknown" };
  }

  const monthsRegistered = Math.max(
    0,
    Math.floor((now.getTime() - registered) / (30.44 * 86_400_000)),
  );

  if (
    monthsRegistered < FIRST_ACCOUNTS_GRACE_MONTHS ||
    input.reportingStatus?.toLowerCase() === "new"
  ) {
    const due = new Date(registered);
    due.setUTCMonth(due.getUTCMonth() + FIRST_ACCOUNTS_GRACE_MONTHS);
    return {
      kind: "too_new",
      monthsRegistered,
      dueFrom: due.toISOString().slice(0, 10),
    };
  }

  return { kind: "nothing_filed", monthsRegistered };
}
