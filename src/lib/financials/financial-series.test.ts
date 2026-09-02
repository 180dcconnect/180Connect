import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFinancialSeries,
  buildFundFlow,
  explainMissingAccounts,
  filingRecency,
} from "./financial-series.ts";

const period = (
  start: string,
  end: string,
  income: number | null,
  expenditure: number | null,
) => ({
  period_start: start,
  period_end: end,
  total_income: income,
  total_expenditure: expenditure,
});

describe("buildFinancialSeries", () => {
  it("orders years oldest first and names them by the year they end in", () => {
    const series = buildFinancialSeries({
      periods: [
        period("2024-04-01", "2025-03-31", 200, 100),
        period("2023-04-01", "2024-03-31", 100, 90),
      ],
      grants: [],
    });

    assert.deepEqual(
      series.years.map((year) => year.label),
      ["FY24", "FY25"],
    );
  });

  it("computes the net position only when both figures are filed", () => {
    const series = buildFinancialSeries({
      periods: [
        period("2023-04-01", "2024-03-31", 100_000, 120_000),
        period("2024-04-01", "2025-03-31", 100_000, null),
      ],
      grants: [],
    });

    assert.equal(series.years[0].net, -20_000);
    assert.equal(series.years[1].net, null);
  });

  it("scales to the largest figure on either series", () => {
    const series = buildFinancialSeries({
      periods: [period("2023-04-01", "2024-03-31", 100, 450)],
      grants: [],
    });

    assert.equal(series.peak, 450);
    assert.equal(series.peakNet, 350);
  });

  it("places a grant in the period its award date falls inside", () => {
    const series = buildFinancialSeries({
      periods: [
        period("2023-04-01", "2024-03-31", 100_000, 90_000),
        period("2024-04-01", "2025-03-31", 100_000, 90_000),
      ],
      grants: [
        { amount_awarded: 10_000, currency: "GBP", award_date: "2023-06-01" },
        { amount_awarded: 5_000, currency: "GBP", award_date: "2024-09-30" },
        { amount_awarded: 999, currency: "GBP", award_date: "2019-01-01" },
      ],
    });

    assert.equal(series.years[0].grantTotal, 10_000);
    assert.equal(series.years[1].grantTotal, 5_000);
    assert.equal(series.years[0].grantShare, 0.1);
  });

  it("counts a period boundary date as inside the period", () => {
    const series = buildFinancialSeries({
      periods: [period("2023-04-01", "2024-03-31", 100, 90)],
      grants: [
        { amount_awarded: 1, currency: "GBP", award_date: "2023-04-01" },
        { amount_awarded: 1, currency: "GBP", award_date: "2024-03-31" },
      ],
    });

    assert.equal(series.years[0].grantTotal, 2);
  });

  it("excludes a non-GBP award from the sum and says so", () => {
    const series = buildFinancialSeries({
      periods: [period("2023-04-01", "2024-03-31", 100_000, 90_000)],
      grants: [
        { amount_awarded: 50_000, currency: "USD", award_date: "2023-06-01" },
        { amount_awarded: 10_000, currency: "GBP", award_date: "2023-06-01" },
      ],
    });

    assert.equal(series.years[0].grantTotal, 10_000);
    assert.equal(series.years[0].grantsExcluded, 1);
    assert.equal(series.hasExcludedGrants, true);
  });

  it("treats a missing currency as the accounts' own", () => {
    const series = buildFinancialSeries({
      periods: [period("2023-04-01", "2024-03-31", 100, 90)],
      grants: [{ amount_awarded: 10, currency: null, award_date: "2023-06-01" }],
    });

    assert.equal(series.years[0].grantTotal, 10);
  });

  it("reports an unknown share rather than zero when income is missing", () => {
    const series = buildFinancialSeries({
      periods: [period("2023-04-01", "2024-03-31", null, 90_000)],
      grants: [{ amount_awarded: 10_000, currency: "GBP", award_date: "2023-06-01" }],
    });

    assert.equal(series.years[0].grantShare, null);
    assert.equal(series.years[0].grantTotal, 10_000);
  });

  it("does not clamp a share above one", () => {
    const series = buildFinancialSeries({
      periods: [period("2023-04-01", "2024-03-31", 10_000, 9_000)],
      grants: [{ amount_awarded: 25_000, currency: "GBP", award_date: "2023-06-01" }],
    });

    assert.equal(series.years[0].grantShare, 2.5);
  });

  it("reports an empty series without throwing", () => {
    const series = buildFinancialSeries({ periods: [], grants: [] });
    assert.deepEqual(series.years, []);
    assert.equal(series.peak, 0);
    assert.equal(series.hasIncome, false);
  });
});

describe("filingRecency", () => {
  const now = new Date("2026-09-02T00:00:00Z");

  it("returns null without a period end", () => {
    assert.equal(filingRecency(null, now), null);
    assert.equal(filingRecency("not-a-date", now), null);
  });

  it("does not call accounts stale inside the filing window", () => {
    const recency = filingRecency("2025-03-31", now);
    assert.equal(recency?.stale, false);
    assert.equal(recency?.monthsOld, 17);
  });

  it("calls accounts stale once a newer year should exist", () => {
    const recency = filingRecency("2024-03-31", now);
    assert.equal(recency?.stale, true);
    assert.match(recency!.label, /2 years ago/);
  });

  it("never reports a negative age for a period ending in the future", () => {
    const recency = filingRecency("2027-03-31", now);
    assert.equal(recency?.monthsOld, 0);
    assert.equal(recency?.stale, false);
  });
});

describe("incomeMix and government income", () => {
  it("orders published sources largest first and drops the unpublished ones", () => {
    const series = buildFinancialSeries({
      periods: [
        {
          period_start: "2023-04-01",
          period_end: "2024-03-31",
          total_income: 100_000,
          total_expenditure: 90_000,
          income_donations_legacies: 20_000,
          income_charitable_activities: 60_000,
          income_investment: null,
          income_govt_grants: 15_000,
        },
      ],
      grants: [],
    });

    assert.deepEqual(
      series.years[0].mix.map((source) => source.label),
      ["Charitable activities", "Donations and legacies"],
    );
    // Government grants are reported *inside* those lines, so they are detail
    // rather than a fourth sibling — listing them alongside would count the
    // same £15,000 twice.
    assert.deepEqual(
      series.years[0].mixDetail.map((source) => source.label),
      ["Government grants"],
    );
    assert.equal(series.hasMix, true);
  });

  it("drops a nil part but keeps a part filed as zero out of the mix", () => {
    const series = buildFinancialSeries({
      periods: [
        {
          period_start: "2023-04-01",
          period_end: "2024-03-31",
          total_income: 10,
          total_expenditure: 10,
          income_investment: 0,
          income_other: null,
        },
      ],
      grants: [],
    });

    assert.deepEqual(series.years[0].mix, []);
  });

  it("adds grants and contracts into one government figure and its share", () => {
    const series = buildFinancialSeries({
      periods: [
        {
          period_start: "2023-04-01",
          period_end: "2024-03-31",
          total_income: 200_000,
          total_expenditure: 190_000,
          income_govt_grants: 40_000,
          income_govt_contracts: 10_000,
        },
      ],
      grants: [],
    });

    assert.equal(series.years[0].governmentIncome, 50_000);
    assert.equal(series.years[0].governmentShare, 0.25);
  });

  it("reports unknown government income when the register published neither line", () => {
    const series = buildFinancialSeries({
      periods: [
        {
          period_start: "2023-04-01",
          period_end: "2024-03-31",
          total_income: 200_000,
          total_expenditure: 190_000,
        },
      ],
      grants: [],
    });

    assert.equal(series.years[0].governmentIncome, null);
    assert.equal(series.years[0].governmentShare, null);
  });
});

describe("explainMissingAccounts", () => {
  const now = new Date("2026-09-02T00:00:00Z");

  it("explains nothing when accounts exist", () => {
    assert.equal(
      explainMissingAccounts({
        periodCount: 3,
        isCharityRegistered: true,
        registeredOn: "2020-01-01",
        reportingStatus: "Submission Received",
        now,
      }),
      null,
    );
  });

  it("explains nothing for an organisation that is not on the charity register", () => {
    assert.equal(
      explainMissingAccounts({
        periodCount: 0,
        isCharityRegistered: false,
        registeredOn: null,
        reportingStatus: null,
        now,
      }),
      null,
    );
  });

  it("says too new for a charity registered eight months ago", () => {
    const reason = explainMissingAccounts({
      periodCount: 0,
      isCharityRegistered: true,
      registeredOn: "2026-01-02",
      reportingStatus: "New",
      now,
    });

    assert.equal(reason?.kind, "too_new");
    assert.equal(reason!.kind === "too_new" && reason.monthsRegistered, 7);
    assert.equal(reason!.kind === "too_new" && reason.dueFrom, "2027-11-02");
  });

  it("trusts the register's own New status over the arithmetic", () => {
    const reason = explainMissingAccounts({
      periodCount: 0,
      isCharityRegistered: true,
      registeredOn: "2019-01-01",
      reportingStatus: "New",
      now,
    });

    assert.equal(reason?.kind, "too_new");
  });

  it("says nothing filed for a charity long past its first deadline", () => {
    const reason = explainMissingAccounts({
      periodCount: 0,
      isCharityRegistered: true,
      registeredOn: "2015-01-01",
      reportingStatus: "Submission Received",
      now,
    });

    assert.equal(reason?.kind, "nothing_filed");
  });

  it("admits it cannot tell without a registration date", () => {
    const reason = explainMissingAccounts({
      periodCount: 0,
      isCharityRegistered: true,
      registeredOn: null,
      reportingStatus: null,
      now,
    });

    assert.equal(reason?.kind, "unknown");
  });
});

// ---------------------------------------------------------------------------
// The income and expenditure split, and the flow built from it
// ---------------------------------------------------------------------------

/**
 * A real staging filing, to the penny — the row that made the nesting rule
 * necessary. Naively summing all six spending lines gives £431,405,590 against
 * a filed total of £362,636,196: £68m of spending that does not exist, which as
 * a chart would be a straightforward lie about a charity's size.
 */
const filedYear = {
  period_start: "2024-04-01",
  period_end: "2025-03-31",
  total_income: 380_000_000,
  total_expenditure: 362_636_196,
  income_donations_legacies: 300_000_000,
  income_charitable_activities: 60_000_000,
  income_other_trading: 15_000_000,
  income_investment: 5_000_000,
  income_endowments: 0,
  income_other: 0,
  income_govt_grants: 40_000_000,
  income_govt_contracts: 12_000_000,
  expenditure_charitable_activities: 239_051_687,
  expenditure_raising_funds: 123_108_767,
  expenditure_governance: 1_332_314,
  expenditure_grants_institutions: 67_306_727,
  expenditure_investment_management: 130_353,
  expenditure_other: 475_742,
};

const yearOf = (period: Record<string, unknown>) =>
  buildFinancialSeries({
    periods: [period as never],
    grants: [],
  }).years[0];

describe("the filed split", () => {
  it("keeps government income out of the trunk, because it nests inside it", () => {
    const year = yearOf(filedYear);

    assert.deepEqual(
      year.mix.map((source) => source.label),
      [
        "Donations and legacies",
        "Charitable activities",
        "Other trading",
        "Investments",
      ],
    );
    assert.deepEqual(
      year.mixDetail.map((source) => source.label),
      ["Government grants", "Government contracts"],
    );
    // The trunk is what the total is made of; the detail is an analysis of it.
    assert.equal(
      year.mix.reduce((sum, source) => sum + source.amount, 0),
      year.income,
    );
  });

  it("splits spending into a trunk that sums to the filed total exactly", () => {
    const year = yearOf(filedYear);

    assert.deepEqual(
      year.spend.map((use) => use.label),
      ["Charitable activities", "Raising funds", "Other spending"],
    );
    assert.equal(
      year.spend.reduce((sum, use) => sum + use.amount, 0),
      362_636_196,
    );
  });

  it("carries nested spending lines as detail, with what they sit inside", () => {
    const year = yearOf(filedYear);

    assert.deepEqual(
      year.spendDetail.map((use) => [use.label, use.within]),
      [
        ["Grants to institutions", "Charitable activities"],
        ["Governance", null],
        ["Investment management", "Raising funds"],
      ],
    );
    assert.ok(year.spendDetail.every((use) => use.nested));
  });

  it("drops a line the register did not publish, but keeps a filed zero out of the bars", () => {
    const year = yearOf({ ...filedYear, expenditure_other: null });

    assert.equal(
      year.spend.some((use) => use.label === "Other spending"),
      false,
    );
  });
});

describe("buildFundFlow", () => {
  it("balances the two sides with a surplus band", () => {
    const flow = buildFundFlow(yearOf(filedYear));
    assert.ok(flow);

    const inTotal = flow.inflows.reduce((sum, band) => sum + band.amount, 0);
    const outTotal = flow.outflows.reduce((sum, band) => sum + band.amount, 0);
    assert.equal(inTotal, outTotal);
    assert.equal(flow.total, inTotal);

    const surplus = flow.outflows.find((band) => band.kind === "surplus");
    assert.equal(surplus?.amount, 380_000_000 - 362_636_196);
  });

  it("gives a line filed on both sides a different id on each", () => {
    // "Charitable activities" is published as an income line and as an
    // expenditure line, and they are different money. Keying off the bare label
    // made hovering one light up the other and report its amount.
    const flow = buildFundFlow(yearOf(filedYear));
    assert.ok(flow);

    const income = flow.inflows.find(
      (band) => band.label === "Charitable activities",
    );
    const spend = flow.outflows.find(
      (band) => band.label === "Charitable activities",
    );
    assert.ok(income);
    assert.ok(spend);
    assert.notEqual(income.id, spend.id);

    const ids = [...flow.inflows, ...flow.outflows].map((band) => band.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("keeps ids unique when a drawdown band is the balancing one", () => {
    const flow = buildFundFlow(
      yearOf({
        ...filedYear,
        total_income: 300_000_000,
        income_donations_legacies: 220_000_000,
      }),
    );
    assert.ok(flow);

    const ids = [...flow.inflows, ...flow.outflows].map((band) => band.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("balances the other way with a drawdown when spending exceeded income", () => {
    const flow = buildFundFlow(
      yearOf({
        ...filedYear,
        total_income: 300_000_000,
        income_donations_legacies: 220_000_000,
      }),
    );
    assert.ok(flow);

    const reserves = flow.inflows.find((band) => band.kind === "reserves");
    assert.equal(reserves?.amount, 362_636_196 - 300_000_000);
    assert.equal(
      flow.outflows.some((band) => band.kind === "surplus"),
      false,
    );
  });

  it("titles the chart with the finding, not the chart type", () => {
    const surplus = buildFundFlow(yearOf(filedYear));
    assert.equal(surplus!.headline, "Took £380m, spent £362.6m, kept £17.4m");

    const deficit = buildFundFlow(
      yearOf({
        ...filedYear,
        total_income: 300_000_000,
        income_donations_legacies: 220_000_000,
      }),
    );
    assert.match(deficit!.headline, /drawing £62\.6m from reserves$/);
  });

  it("never draws a nested line as a band", () => {
    const flow = buildFundFlow(yearOf(filedYear));
    assert.ok(flow);

    const drawn = [...flow.inflows, ...flow.outflows].map((band) => band.label);
    for (const nested of [
      "Government grants",
      "Government contracts",
      "Grants to institutions",
      "Governance",
      "Investment management",
    ]) {
      assert.equal(drawn.includes(nested), false, `${nested} should not be a band`);
    }
  });

  it("returns null when only one side published a split", () => {
    assert.equal(
      buildFundFlow(
        yearOf({
          ...filedYear,
          expenditure_charitable_activities: null,
          expenditure_raising_funds: null,
          expenditure_other: null,
        }),
      ),
      null,
    );
  });

  it("returns null rather than a diagram whose sides cannot be squared", () => {
    // Filed lines that miss their own filed total by a fifth: a restatement
    // this large is not a caveat, it is a picture of arithmetic that did not
    // happen.
    assert.equal(
      buildFundFlow(yearOf({ ...filedYear, total_income: 300_000_000 })),
      null,
    );
  });
});


describe("scale, filing dates and government relationships", () => {
  const period = {
    period_start: "2024-04-01",
    period_end: "2025-03-31",
    total_income: 400_000,
    total_expenditure: 390_000,
  };

  it("carries the filing date, the counts and the award count", () => {
    const series = buildFinancialSeries({
      periods: [
        {
          ...period,
          filing_date: "2025-11-30",
          count_employees: 12,
          count_volunteers: 90,
          count_govt_grants: 3,
          count_govt_contracts: 1,
        },
      ],
      grants: [],
    });

    const year = series.years[0];
    assert.equal(year.filedOn, "2025-11-30");
    assert.equal(year.employees, 12);
    assert.equal(year.volunteers, 90);
    assert.equal(year.governmentAwards, 4, "grants and contracts count together");
  });

  it("keeps a filed zero distinct from an unpublished figure", () => {
    const series = buildFinancialSeries({
      periods: [{ ...period, count_employees: 0, count_volunteers: null }],
      grants: [],
    });

    assert.equal(series.years[0].employees, 0, "no paid staff is a real answer");
    assert.equal(series.years[0].volunteers, null);
  });

  it("reports an unknown award count rather than zero", () => {
    const series = buildFinancialSeries({ periods: [period], grants: [] });
    assert.equal(series.years[0].governmentAwards, null);
    assert.equal(series.years[0].filedOn, null);
  });

  it("counts one published side when the other is absent", () => {
    const series = buildFinancialSeries({
      periods: [{ ...period, count_govt_contracts: 1 }],
      grants: [],
    });
    assert.equal(series.years[0].governmentAwards, 1);
  });
});

describe("filingRecency with a published filing date", () => {
  const now = new Date("2026-09-02T00:00:00Z");

  it("reports the filing date without letting it change the age", () => {
    // Age is about how old the figures are, not how promptly they were filed:
    // a year ended 17 months ago is the newest that exists either way.
    const recency = filingRecency("2025-03-31", now, "2025-11-30");
    assert.equal(recency?.filedOn, "2025-11-30");
    assert.equal(recency?.monthsOld, 17);
    assert.equal(recency?.stale, false);
  });

  it("leaves the filing date null for a source that does not publish one", () => {
    assert.equal(filingRecency("2025-03-31", now)?.filedOn, null);
  });

  it("ignores a filing date it cannot parse", () => {
    assert.equal(filingRecency("2025-03-31", now, "not-a-date")?.filedOn, null);
  });
});
