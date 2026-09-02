import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFinancialSeries,
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
      ["Charitable activities", "Donations and legacies", "Government grants"],
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
