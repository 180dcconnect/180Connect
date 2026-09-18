/**
 * The shapes the Charity Commission's extracts actually publish, and the small
 * amount of interpretation the register build does on them.
 *
 * Split from the reader (extract-stream.ts) so the build script has one place to
 * look for "what does a row of publicextract.charity contain", and so the
 * field-name mapping between the extracts and our columns is testable without a
 * database or a 500MB file.
 *
 * Only the fields the register file stores are typed. The extracts publish far
 * more — Part A alone carries 50 fields, most of them salary-band headcounts
 * nothing in this product reads — and typing those would suggest they are
 * available downstream when they are not.
 */

/** One row of publicextract.charity, as far as the register build reads it. */
export type ExtractCharity = {
  organisation_number: number;
  registered_charity_number: number | null;
  linked_charity_number: number;
  charity_name: string | null;
  charity_type: string | null;
  charity_registration_status: string | null;
  charity_reporting_status: string | null;
  date_of_registration: string | null;
  date_of_removal: string | null;
  latest_income: number | null;
  latest_expenditure: number | null;
  latest_acc_fin_period_start_date: string | null;
  latest_acc_fin_period_end_date: string | null;
  charity_contact_address1: string | null;
  charity_contact_address2: string | null;
  charity_contact_address3: string | null;
  charity_contact_address4: string | null;
  charity_contact_address5: string | null;
  charity_contact_postcode: string | null;
  charity_contact_phone: string | null;
  charity_contact_email: string | null;
  charity_contact_web: string | null;
  charity_company_registration_number: string | null;
  charity_is_cio: boolean | null;
  charity_gift_aid: boolean | null;
  charity_has_land: boolean | null;
  charity_insolvent: boolean | null;
  charity_in_administration: boolean | null;
  charity_activities: string | null;
};

/** A row of either annual-return extract, keyed by charity and period. */
export type ExtractAnnualReturn = Record<string, unknown> & {
  organisation_number: number;
  fin_period_start_date?: string | null;
  fin_period_end_date?: string | null;
};

export type ExtractClassification = {
  organisation_number: number;
  classification_type: string | null;
  classification_description: string | null;
};

export type ExtractArea = {
  organisation_number: number;
  geographic_area_type: string | null;
  geographic_area_description: string | null;
};

/**
 * The postcode *area* — the letters before the first digit.
 *
 * "S1 2HE" is Sheffield, "SA1 1AA" is Swansea. Stored as its own column so an
 * area filter is an exact match: comparing `startsWith("S")` would also select
 * SA, SE, SK, SL, SO, SW and SY, roughly a tenth of the register. That mistake
 * is not hypothetical — an earlier version of this import matched place names
 * loosely and silently missed 127 Sheffield charities.
 */
export function postcodeAreaOf(postcode: string | null | undefined): string | null {
  const compact = (postcode ?? "").toUpperCase().replace(/\s+/g, "");
  const match = /^([A-Z]{1,2})\d/.exec(compact);
  return match ? match[1] : null;
}

/** A YYYY-MM-DD date, or null. The extracts publish full timestamps. */
export function dateOnly(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The extract field each stored return column comes from, in priority order.
 *
 * Part A and Part B name the same idea differently: a small charity files
 * `total_gross_income` where a larger one files
 * `income_total_income_and_endowments`. Where both are present Part B wins — it
 * is the fuller return, filed only by larger charities (79,398 rows against Part
 * A's 662,653).
 *
 * Verified against the live extracts on 2026-09-03. Two details that cost time
 * if you get them wrong: `income_investments` is plural, and the
 * government-funding fields exist only in Part A.
 */
export const RETURN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  total_income: ["income_total_income_and_endowments", "total_gross_income"],
  total_expenditure: ["expenditure_total", "total_gross_expenditure"],
  income_donations_legacies: ["income_donations_and_legacies"],
  income_charitable_activities: ["income_charitable_activities"],
  income_other_trading: ["income_other_trading_activities"],
  income_investment: ["income_investments"],
  income_endowments: ["income_endowments"],
  income_other: ["income_other"],
  income_govt_grants: ["income_from_government_grants"],
  income_govt_contracts: ["income_from_government_contracts"],
  expenditure_charitable_activities: ["expenditure_charitable_expenditure"],
  expenditure_raising_funds: ["expenditure_raising_funds"],
  expenditure_governance: ["expenditure_governance"],
  expenditure_grants_institutions: ["expenditure_grants_institution"],
  expenditure_investment_management: ["expenditure_investment_management"],
  expenditure_other: ["expenditure_other"],
  count_employees: ["count_employees"],
  count_volunteers: ["count_volunteers"],
  count_govt_grants: ["count_govt_grants"],
  count_govt_contracts: ["count_govt_contracts"],
};

/** The first of several candidate fields that carries a usable number. */
export function pickNumber(
  row: ExtractAnnualReturn,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}
