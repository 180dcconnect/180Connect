// Charity Commission financial data — the two calls that carry money, and
// nothing else.
//
// Confirmed against the live API (2026-09-02, key from CHARITY_COMMISSION_API_KEY):
//
//   1. charitydetailsmulti/{n1,n2,…}     — up to 30 charities per call. Carries
//      latest_acc_fin_year_start_date / _end_date, latest_income and
//      latest_expenditure: one authoritative period per charity, with a real
//      period *start*.
//   2. charityfinancialhistory/{n}/{s}   — one charity per call. Returns the
//      last five annual returns (AR21…AR25 for a charity filing on time), each
//      with income, expenditure and a period *end* date — no start date, and a
//      much richer breakdown (donations and legacies, government grants and
//      contracts, charitable-activity spend) that FINANCIAL_PERIODS has no
//      columns for and this module therefore drops.
//
// Five years is the ceiling, not a parameter: the endpoint returns what it
// returns. There is no "last ten years" to ask for.
//
// Endpoints that do NOT exist, checked so nobody checks them again:
// charityarhistory, charityannualreturnhistory, charitysubmissionhistory,
// charityaccountsubmission, charitypublishedreport, charitytrustees — all 404.
// In particular there is no accounts-*submission-date* endpoint, so
// FINANCIAL_PERIODS.filing_date cannot be populated from this API at all;
// filing recency has to be read from period_end (see src/lib/financials).

import {
  CHARITY_COMMISSION_URL,
  DETAILS_BATCH_SIZE,
  chunk,
  fetchCharityDetails,
  fetchWithRetry,
  type CharityCommissionDetailItem,
} from "./charity-commission.ts";

/**
 * One annual return as `charityfinancialhistory` returns it.
 *
 * The breakdown is the reason this endpoint is worth a call per charity: income
 * from government grants and from government contracts appear nowhere else in
 * any source we hold, and the SOFA split answers a different question from the
 * totals ("how much of this is public money?" rather than "how big are they?").
 *
 * Every part is nullable and none of them is trusted to sum to the total: a
 * smaller charity files an entry-level return with totals only, and the register
 * publishes the parts it has. `inc_legacies` is deliberately not read — it is a
 * subset of `inc_donations_and_legacies`, and storing both invites a double
 * count downstream.
 */
export type CharityFinancialHistoryItem = {
  ar_cycle_reference: string | null;
  financial_period_end_date: string | null;
  income: number | null;
  expenditure: number | null;
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

/** The latest filed year, as `charitydetailsmulti` reports it — plus the two
 *  register facts that make an empty Financials tab explainable rather than
 *  blank: when the charity was registered, and what the register says about its
 *  reporting position ("New" until a first return arrives). */
export type CharityLatestFinancials = {
  registeredNumber: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalIncome: number | null;
  totalExpenditure: number | null;
  registeredOn: string | null;
  reportingStatus: string | null;
};

export function charityCommissionHeaders(): Record<string, string> {
  const apiKey = process.env.CHARITY_COMMISSION_API_KEY;
  if (!apiKey) throw new Error("CHARITY_COMMISSION_API_KEY is not set.");
  return { "Ocp-Apim-Subscription-Key": apiKey };
}

/** A payload figure as a number — the API sends numbers here, but the details
 *  endpoint has been seen sending numeric strings, so both are accepted. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ISO datetime ("2024-04-01T00:00:00") → plain date, or null when malformed. */
function toDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * The latest filed year for a list of charities, batched 30 at a time.
 *
 * A batch that fails is logged and skipped rather than aborting the run: the
 * caller is walking thousands of charities, and one transient 500 must not cost
 * the other 29 in the batch or the 900 after it.
 */
export async function fetchLatestFinancials(
  registeredNumbers: readonly string[],
  headers: Record<string, string> = charityCommissionHeaders(),
): Promise<Map<string, CharityLatestFinancials>> {
  const byNumber = new Map<string, CharityLatestFinancials>();

  for (const batch of chunk([...registeredNumbers], DETAILS_BATCH_SIZE)) {
    let details: CharityCommissionDetailItem[];
    try {
      details = await fetchCharityDetails(batch, headers);
    } catch (error) {
      console.warn(
        `[charity_commission] financial details batch skipped: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    for (const item of details) {
      const registeredNumber = String(item.reg_charity_number ?? "").trim();
      if (!registeredNumber) continue;
      byNumber.set(registeredNumber, {
        registeredNumber,
        periodStart: toDate(item.latest_acc_fin_year_start_date),
        periodEnd: toDate(item.latest_acc_fin_year_end_date),
        totalIncome: toNumber(item.latest_income),
        totalExpenditure: toNumber(item.latest_expenditure),
        registeredOn: toDate(item.date_of_registration),
        reportingStatus:
          typeof item.reporting_status === "string" && item.reporting_status.trim()
            ? item.reporting_status.trim()
            : null,
      });
    }
  }

  return byNumber;
}

/**
 * Up to five years of filed accounts for one charity.
 *
 * Returns an empty array rather than throwing for the two cases that are
 * normal rather than exceptional: a charity too new to have filed anything
 * (404), and a body that is not the array the endpoint documents.
 */
export async function fetchFinancialHistory(
  registeredNumber: string,
  headers: Record<string, string> = charityCommissionHeaders(),
  /** Group/subsidiary suffix; 0 for every charity we hold. */
  suffix = 0,
): Promise<CharityFinancialHistoryItem[]> {
  const url = `${CHARITY_COMMISSION_URL}/charityfinancialhistory/${registeredNumber}/${suffix}`;
  const res = await fetchWithRetry(url, headers);

  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(
      `Charity Commission financial history API returned ${res.status} for ${registeredNumber}`,
    );
  }

  const json = await res.json();
  if (!Array.isArray(json)) return [];

  return json.map((row) => ({
    ar_cycle_reference:
      typeof row?.ar_cycle_reference === "string" ? row.ar_cycle_reference : null,
    financial_period_end_date: toDate(row?.financial_period_end_date),
    income: toNumber(row?.income),
    expenditure: toNumber(row?.expenditure),
    incomeDonationsLegacies: toNumber(row?.inc_donations_and_legacies),
    incomeCharitableActivities: toNumber(row?.inc_charitable_activities),
    incomeOtherTrading: toNumber(row?.inc_other_trading_activities),
    incomeInvestment: toNumber(row?.inc_investment),
    incomeEndowments: toNumber(row?.inc_endowments),
    incomeOther: toNumber(row?.inc_other),
    incomeGovtGrants: toNumber(row?.income_from_govt_grants),
    incomeGovtContracts: toNumber(row?.income_from_govt_contracts),
    expenditureCharitableActivities: toNumber(row?.exp_charitable_activities),
    expenditureRaisingFunds: toNumber(row?.exp_raising_funds),
    expenditureGovernance: toNumber(row?.exp_governance),
    expenditureGrantsInstitutions: toNumber(row?.exp_grants_institution),
    expenditureInvestmentManagement: toNumber(row?.exp_investment_management),
    expenditureOther: toNumber(row?.exp_other),
  }));
}
