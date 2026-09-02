// The Financials tab's chart data, built once and shared by every mark on it.
//
// Pure and testable, and deliberately not inside the chart component: the
// awkward decisions here are about *money and dates*, not about pixels — which
// grant belongs to which filed year, what counts as a comparable currency, and
// what a share of income means when the denominator is missing.

import {
  deriveIncomeBand,
  formatCompactGbp,
  type IncomeBand,
} from "../income-band.ts";

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
  /** When the regulator received the return. Only the bulk register extract
   *  publishes this — the API has no endpoint for it. */
  filing_date?: string | null;
  count_employees?: number | null;
  count_volunteers?: number | null;
  receives_govt_grants?: boolean | null;
  receives_govt_contracts?: boolean | null;
  count_govt_grants?: number | null;
  count_govt_contracts?: number | null;
  expenditure_charitable_activities?: number | null;
  expenditure_raising_funds?: number | null;
  expenditure_governance?: number | null;
  expenditure_grants_institutions?: number | null;
  expenditure_investment_management?: number | null;
  expenditure_other?: number | null;
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
  /** Where the income came from, largest first — only the parts published.
   *  Trunk lines only: the two government lines sit inside these, and are in
   *  `mixDetail` instead. */
  mix: IncomeSource[];
  /** Lines the register reports *inside* a trunk line. Never summed with
   *  `mix` — doing so double-counts the same money. */
  mixDetail: IncomeSource[];
  /** Where the money went, largest first — trunk lines only, same rule. */
  spend: SpendUse[];
  /** Spending lines reported inside a trunk line. Never summed with `spend`. */
  spendDetail: SpendUse[];
  /** Government grants + contracts, or null when neither was published. */
  governmentIncome: number | null;
  /** governmentIncome / income, or null when either side is unknown. */
  governmentShare: number | null;
  /** When the regulator received this return, where that is published. */
  filedOn: string | null;
  /** Staff and volunteers as reported on the return. Null is "not published"
   *  — an entry-level return files totals only — and 0 is a filed zero. */
  employees: number | null;
  volunteers: number | null;
  /**
   * How many government awards sat behind the money, where the return says.
   *
   * The amount alone cannot tell a standing relationship from a windfall:
   * £400k as one contract is a client with a public-sector partner, £400k
   * across fifteen small grants is a client who spends its year fundraising.
   * Those are different conversations.
   */
  governmentAwards: number | null;
};

/** One published income source for a year. */
export type IncomeSource = {
  label: string;
  amount: number;
  /** True for the two government lines, which the UI pulls out separately. */
  government: boolean;
  /**
   * The trunk line this figure is reported *inside*, or null when it is itself
   * a trunk line. A nested figure is an "of which", never its own flow.
   *
   * `null` on a nested line means the register spreads it across more than one
   * trunk line and does not publish the allocation — real for the government
   * lines, which turn up inside charitable activities and donations both.
   */
  within?: string | null;
};

/** One published spending line for a year. Same nesting rule as IncomeSource. */
export type SpendUse = {
  label: string;
  amount: number;
  /** Reported inside another line, so never summed with the trunk. */
  nested: boolean;
  /** The trunk line it sits inside, or null when the register spreads it. */
  within: string | null;
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
  /** True when any year published an expenditure split. */
  hasSpend: boolean;
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
 * **What nests inside what.** The register publishes a SOFA, and a SOFA is a
 * tree, not a list. The first six lines are the trunk: they are what
 * `total_income` is the sum of. The two government lines are an *analysis* of
 * that money by where it came from — public grant funding turns up inside
 * charitable-activities income and inside donations both — so adding all eight
 * counts the same pounds twice. Checked against staging: the six sum to
 * `total_income` exactly on 17 of 20 filed years and never fall short, while
 * all eight overshoot on 14 of 20.
 *
 * `inc_legacies` is deliberately absent for the same reason: the register
 * reports it inside donations and legacies.
 */
const INCOME_SOURCE_LABELS: {
  key: keyof FinancialPeriodInput;
  label: string;
  government: boolean;
  /** Undefined for a trunk line; null for a nested line with no single parent. */
  within?: string | null;
}[] = [
  { key: "income_donations_legacies", label: "Donations and legacies", government: false },
  { key: "income_charitable_activities", label: "Charitable activities", government: false },
  { key: "income_other_trading", label: "Other trading", government: false },
  { key: "income_investment", label: "Investments", government: false },
  { key: "income_endowments", label: "Endowments", government: false },
  { key: "income_other", label: "Other income", government: false },
  { key: "income_govt_grants", label: "Government grants", government: true, within: null },
  { key: "income_govt_contracts", label: "Government contracts", government: true, within: null },
];

/**
 * The register's expenditure lines, and which of them are the trunk.
 *
 * Charitable activities, raising funds and other spending are what
 * `total_expenditure` is the sum of — exactly, on all 20 filed years on staging,
 * to the penny. The other three are components of those:
 *
 *   - grants to institutions sits inside charitable activities;
 *   - investment management sits inside raising funds;
 *   - governance is a support cost the SOFA apportions across both, and the
 *     register does not publish the split — hence `within: null`.
 *
 * This matters more here than on the income side: naively summing all six
 * overshoots by 19% on a real staging row (£431m of "parts" against a filed
 * £363m total), which as a chart would read as £68m of spending that does not
 * exist.
 */
const SPEND_USE_LABELS: {
  key: keyof FinancialPeriodInput;
  label: string;
  within?: string | null;
}[] = [
  { key: "expenditure_charitable_activities", label: "Charitable activities" },
  { key: "expenditure_raising_funds", label: "Raising funds" },
  { key: "expenditure_other", label: "Other spending" },
  {
    key: "expenditure_grants_institutions",
    label: "Grants to institutions",
    within: "Charitable activities",
  },
  {
    key: "expenditure_investment_management",
    label: "Investment management",
    within: "Raising funds",
  },
  { key: "expenditure_governance", label: "Governance", within: null },
];

/**
 * The published parts of a year's income: trunk lines and nested lines apart.
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
function incomeMix(period: FinancialPeriodInput): {
  trunk: IncomeSource[];
  detail: IncomeSource[];
} {
  const trunk: IncomeSource[] = [];
  const detail: IncomeSource[] = [];
  for (const { key, label, government, within } of INCOME_SOURCE_LABELS) {
    const value = period[key];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    if (value === 0) continue;
    const nested = within !== undefined;
    (nested ? detail : trunk).push({
      label,
      amount: value,
      government,
      within: nested ? within : undefined,
    });
  }
  const bySize = (a: { amount: number }, b: { amount: number }) => b.amount - a.amount;
  return { trunk: trunk.sort(bySize), detail: detail.sort(bySize) };
}

/** The same split for spending. Nulls dropped, filed zeroes kept, nothing
 *  reconciled — see incomeMix. */
function expenditureMix(period: FinancialPeriodInput): {
  trunk: SpendUse[];
  detail: SpendUse[];
} {
  const trunk: SpendUse[] = [];
  const detail: SpendUse[] = [];
  for (const { key, label, within } of SPEND_USE_LABELS) {
    const value = period[key];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    if (value === 0) continue;
    const nested = within !== undefined;
    (nested ? detail : trunk).push({
      label,
      amount: value,
      nested,
      within: nested ? within : null,
    });
  }
  const bySize = (a: { amount: number }, b: { amount: number }) => b.amount - a.amount;
  return { trunk: trunk.sort(bySize), detail: detail.sort(bySize) };
}

/** A published figure, or null. Distinguishes a filed zero from an absence. */
function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

/** Two counts added, or null when the register published neither. */
function sumOrNull(
  first: number | null | undefined,
  second: number | null | undefined,
): number | null {
  const a = numberOrNull(first);
  const b = numberOrNull(second);
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
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
      const spend = expenditureMix(period);
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
        mix: mix.trunk,
        mixDetail: mix.detail,
        spend: spend.trunk,
        spendDetail: spend.detail,
        governmentIncome: government,
        governmentShare:
          government !== null && income !== null && income > 0
            ? government / income
            : null,
        filedOn: period.filing_date?.slice(0, 10) ?? null,
        employees: numberOrNull(period.count_employees),
        volunteers: numberOrNull(period.count_volunteers),
        governmentAwards: sumOrNull(period.count_govt_grants, period.count_govt_contracts),
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
    hasSpend: years.some((year) => year.spend.length > 0),
    hasExcludedGrants: years.some((year) => year.grantsExcluded > 0),
  };
}

// ---------------------------------------------------------------------------
// Where the money flowed — the Sankey model
// ---------------------------------------------------------------------------

/** One band entering or leaving the year. */
export type FlowBand = {
  /**
   * Unique across *both* sides, hence the `in:` / `out:` prefix.
   *
   * The label alone is not unique: "Charitable activities" is a line the
   * register publishes on the income side and on the expenditure side both, and
   * they are different money. A consumer keying hover or selection off a bare
   * label lights up two unrelated bands and reads the wrong amount back — so
   * the side is part of the identity, not something the caller has to remember
   * to add.
   */
  id: string;
  label: string;
  amount: number;
  /**
   * `filed` is a line the register published.
   *
   * `surplus` and `reserves` are the two balancing bands, and they are not
   * inventions: a year that took in more than it spent really did put the
   * difference somewhere, and a year that spent more really did draw it from
   * somewhere. They are `income − expenditure` given a direction and a name.
   */
  kind: "filed" | "surplus" | "reserves";
  /** True for a band the reader should be able to pick out as public money. */
  government?: boolean;
};

export type FundFlow = {
  /** "FY24". */
  label: string;
  periodEnd: string;
  /**
   * The chart's title, and it states the finding rather than naming the chart:
   * what came in, what went out, and which way the year closed. A reader who
   * only ever reads the title should still leave with the conclusion.
   */
  headline: string;
  /** Left-hand bands: filed income lines, plus reserves drawn down if any. */
  inflows: FlowBand[];
  /** Right-hand bands: filed spending lines, plus a surplus if any. */
  outflows: FlowBand[];
  /**
   * The one number both sides are drawn against. Each side sums to exactly
   * this, which is the property that makes the diagram readable at all.
   */
  total: number;
  /** Public money, where the register said — an annotation, never a band. */
  governmentIncome: number | null;
  /** Nested "of which" lines, for the footnotes under each side. */
  incomeDetail: IncomeSource[];
  spendDetail: SpendUse[];
  /**
   * How far the filed trunk lines missed the filed totals, as a fraction.
   * Zero on most filings. Non-zero is worth saying out loud rather than
   * silently scaling away — it means the return restated something.
   */
  incomeDrift: number;
  spendDrift: number;
};

/**
 * How much a side may miss its own filed total before the diagram is not worth
 * drawing. The register reconciles exactly on the overwhelming majority of
 * filings; the handful that drift do so by a few percent, from a restatement
 * between the summary figure and the detailed return.
 *
 * Past this, the honest move is to draw nothing and leave the bar panels to it.
 * A Sankey whose two sides disagree by a tenth is not a chart with a caveat, it
 * is a picture of arithmetic that did not happen.
 */
export const FLOW_DRIFT_LIMIT = 0.05;

/**
 * A year's money as a flow: what came in on the left, what it paid for on the
 * right, and the surplus or drawdown that squares the two.
 *
 * Returns null unless *both* sides published a split. A Sankey with one side is
 * a bar chart drawn the hard way, and the bar panels already do that better.
 *
 * The two sides are balanced by construction — the surplus or reserves band is
 * whatever the filed lines leave over — so no flow is ever scaled, padded or
 * clipped to make the picture close. Where the filed lines cannot be squared
 * with the filed totals beyond FLOW_DRIFT_LIMIT, the answer is null and the
 * caller falls back.
 *
 * Nested lines (government income, grants to institutions, governance) are
 * carried as detail rather than drawn: they are subsets of bands already on the
 * diagram, and a Sankey that draws a subset as its own band is double-counting
 * in the one chart type where the reader is entitled to assume the widths add
 * up. See SPEND_USE_LABELS for what nests inside what.
 */
export function buildFundFlow(year: FinancialYear): FundFlow | null {
  if (year.mix.length === 0 || year.spend.length === 0) return null;

  const incomeAccounted = year.mix.reduce((sum, source) => sum + source.amount, 0);
  const spendAccounted = year.spend.reduce((sum, use) => sum + use.amount, 0);
  if (incomeAccounted <= 0 || spendAccounted <= 0) return null;

  const drift = (accounted: number, filed: number | null) =>
    filed === null || filed <= 0 ? 0 : Math.abs(accounted - filed) / filed;

  const incomeDrift = drift(incomeAccounted, year.income);
  const spendDrift = drift(spendAccounted, year.expenditure);
  if (incomeDrift > FLOW_DRIFT_LIMIT || spendDrift > FLOW_DRIFT_LIMIT) return null;

  const inflows: FlowBand[] = year.mix.map((source) => ({
    id: `in:${source.label}`,
    label: source.label,
    amount: source.amount,
    kind: "filed" as const,
    government: source.government,
  }));
  const outflows: FlowBand[] = year.spend.map((use) => ({
    id: `out:${use.label}`,
    label: use.label,
    amount: use.amount,
    kind: "filed" as const,
  }));

  // The balancing band. Drawn against the *accounted* sums rather than the
  // filed totals, so the width on screen is the width the other bands leave —
  // a surplus band that disagreed with the gap beside it would be worse than
  // no band at all.
  const gap = incomeAccounted - spendAccounted;
  if (gap > 0) {
    outflows.push({
      id: "out:surplus",
      label: "Surplus for the year",
      amount: gap,
      kind: "surplus",
    });
  } else if (gap < 0) {
    inflows.push({
      id: "in:reserves",
      label: "Drawn from reserves",
      amount: -gap,
      kind: "reserves",
    });
  }

  // The chart's own formatter, so the title and the band labels never disagree
  // about how many millions a number is.
  const money = formatCompactGbp;

  const headline =
    gap > 0
      ? `Took ${money(incomeAccounted)}, spent ${money(spendAccounted)}, kept ${money(gap)}`
      : gap < 0
        ? `Spent ${money(spendAccounted)} against ${money(incomeAccounted)} in, drawing ${money(-gap)} from reserves`
        : `Spent every one of the ${money(incomeAccounted)} it took in`;

  return {
    label: year.label,
    periodEnd: year.periodEnd,
    headline,
    inflows,
    outflows,
    total: Math.max(incomeAccounted, spendAccounted),
    governmentIncome: year.governmentIncome,
    incomeDetail: year.mixDetail,
    spendDetail: year.spendDetail,
    incomeDrift,
    spendDrift,
  };
}

/**
 * Every year that can be drawn as a flow, newest first.
 *
 * Newest first because the chart opens on the most recent one and the reader
 * steps backwards through the filing history from there.
 */
export function buildFundFlows(series: FinancialSeries): FundFlow[] {
  return [...series.years]
    .reverse()
    .map(buildFundFlow)
    .filter((flow): flow is FundFlow => flow !== null);
}

export type FilingRecency = {
  /** Whole months between the period end and now. */
  monthsOld: number;
  /** Past the point where the register would expect newer accounts. */
  stale: boolean;
  /** "Filed for the year ended 31 Mar 2025" style age, in words. */
  label: string;
  /**
   * The date the regulator received the return, where it is published.
   *
   * The staleness rule itself still measures from the period end, and that is
   * the right basis: the question is how old the *figures* are, not how
   * promptly they were filed. This is here so the card can say "filed 30 Nov
   * 2025" as a fact instead of leaving the reader to infer it.
   */
  filedOn: string | null;
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
 * Age is measured from the period end, which every filing has, rather than from
 * FINANCIAL_PERIODS.filing_date, which only the bulk register extract publishes
 * (the API has no accounts-submission endpoint at all — see
 * charity-commission-financials.ts). Where a filing date *is* held it is
 * reported alongside as an exact fact rather than folded into the age.
 */
export const STALE_AFTER_MONTHS = 22;

export function filingRecency(
  periodEnd: string | null | undefined,
  now: Date = new Date(),
  /** FINANCIAL_PERIODS.filing_date, where the source published one. Appended
   *  rather than inserted so every existing call keeps working. */
  filedOn?: string | null,
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

  const filed = filedOn?.slice(0, 10) ?? null;
  return {
    monthsOld: months,
    stale: months > STALE_AFTER_MONTHS,
    label,
    filedOn: filed && !Number.isNaN(Date.parse(`${filed}T00:00:00Z`)) ? filed : null,
  };
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
