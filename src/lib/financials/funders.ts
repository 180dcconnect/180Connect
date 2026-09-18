import type { GrantInput } from "./financial-series.ts";

/**
 * Who a client's grant money actually comes from, and how concentrated it is.
 *
 * **The question this answers.** A CAM looking at £600k of awards wants to know
 * whether that is one funder or fifteen, and whether the relationships repeat.
 * One funder at 90% is a fragility signal and a conversation opener; fifteen
 * funders at 7% each is a fundraising operation with a rhythm to it. The grant
 * table below the section shows every award and answers neither question,
 * because reading concentration off a paginated list is a job nobody does.
 *
 * There is no balance sheet in the data model — no reserves, no assets, no
 * liabilities — so funder concentration is the closest honest read on financial
 * fragility we can offer. It is not a substitute for reserves and is not
 * presented as one.
 *
 * **Currency is handled the way `buildFinancialSeries` handles it.** Awards are
 * summed only in the accounts' own currency; a USD award is real money but
 * adding it to a sterling total is arithmetic on two units. Non-GBP awards are
 * counted, excluded from every total and share, and said out loud — the same
 * contract as `FinancialYear.grantsExcluded`.
 *
 * **A share of an unknown denominator is `null`, never `0`.** The house rule
 * across this directory. A client whose awards all have a null `amount_awarded`
 * has funders but no money to apportion, and reporting "0%" there would be a
 * claim the data does not make.
 *
 * **An unnamed funder is not a funder.** 360Giving requires a funder name, but
 * the column is only `NOT NULL` in our schema — a blank or whitespace name has
 * nothing to group on and would otherwise collapse every such award into one
 * fictitious funder called "".
 */

/** Matches `financial-series.ts`. Awards outside this currency are excluded
 *  from every total rather than converted at a rate we do not hold. */
const ACCOUNTS_CURRENCY = "GBP";

/** What the section needs from a grant. Wider than `GrantInput` by the one
 *  column the chart query did not previously select. */
export type FunderGrantInput = GrantInput & {
  funder_name?: string | null;
};

export type FunderTotal = {
  name: string;
  /** Summed GBP awards from this funder. */
  amount: number;
  /** How many awards, including any that carried no amount. */
  awards: number;
};

export type FunderProfile = {
  /** Distinct named funders with at least one countable award. */
  funderCount: number;
  /** Awards that were counted — GBP, named funder. */
  awardCount: number;
  /** Total GBP awarded across every counted award. */
  total: number;
  /** Largest first. Ties broken by award count, then name, so the order is
   *  stable across renders and across two clients with identical figures. */
  funders: FunderTotal[];
  /** The biggest funder's share of `total`, or null when there is no money to
   *  apportion. Never clamped — see the note on `top` below. */
  topShare: number | null;
  /** Funders with two or more counted awards. A repeat funder is a relationship;
   *  a one-off is a transaction. */
  repeatFunders: number;
  /** The newest counted award, by award date. Null when no award carries a date. */
  latest: { name: string; amount: number | null; awardDate: string } | null;
  /** Awards left out because they were not in the accounts' currency. */
  excludedCurrency: number;
  /** Awards left out because they carried no usable funder name. */
  excludedUnnamed: number;
};

const EMPTY: FunderProfile = {
  funderCount: 0,
  awardCount: 0,
  total: 0,
  funders: [],
  topShare: null,
  repeatFunders: 0,
  latest: null,
  excludedCurrency: 0,
  excludedUnnamed: 0,
};

/**
 * Group awards by funder and describe the shape of the result.
 *
 * Returns the empty profile rather than null for no input, so a caller can read
 * `.funderCount === 0` without a null check and the "nothing to show" decision
 * stays in one place — the component.
 */
export function summariseFunders(
  grants: readonly FunderGrantInput[],
): FunderProfile {
  if (grants.length === 0) return EMPTY;

  const byFunder = new Map<string, FunderTotal>();
  let total = 0;
  let awardCount = 0;
  let excludedCurrency = 0;
  let excludedUnnamed = 0;
  let latest: FunderProfile["latest"] = null;

  for (const grant of grants) {
    if ((grant.currency ?? ACCOUNTS_CURRENCY).toUpperCase() !== ACCOUNTS_CURRENCY) {
      excludedCurrency += 1;
      continue;
    }
    const name = grant.funder_name?.trim();
    if (!name) {
      excludedUnnamed += 1;
      continue;
    }

    // An award with no amount still evidences a relationship, so it counts
    // toward the funder's award tally and toward "repeat funder" — it just adds
    // nothing to the money.
    const amount = grant.amount_awarded;
    const existing = byFunder.get(name);
    if (existing) {
      existing.amount += amount ?? 0;
      existing.awards += 1;
    } else {
      byFunder.set(name, { name, amount: amount ?? 0, awards: 1 });
    }

    total += amount ?? 0;
    awardCount += 1;

    const awardDate = grant.award_date?.slice(0, 10);
    // ISO dates compare correctly as strings, which is what the rest of this
    // directory relies on for period bucketing.
    if (awardDate && (latest === null || awardDate > latest.awardDate)) {
      latest = { name, amount, awardDate };
    }
  }

  const funders = [...byFunder.values()].sort(
    (a, b) => b.amount - a.amount || b.awards - a.awards || a.name.localeCompare(b.name),
  );

  return {
    funderCount: funders.length,
    awardCount,
    total,
    funders,
    topShare: total > 0 && funders.length > 0 ? funders[0].amount / total : null,
    repeatFunders: funders.filter((funder) => funder.awards > 1).length,
    latest,
    excludedCurrency,
    excludedUnnamed,
  };
}
