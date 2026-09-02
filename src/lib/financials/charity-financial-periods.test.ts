import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFinancialPeriods } from "./charity-financial-periods.ts";
import type { CharityFinancialHistoryItem } from "../ingestion/sources/charity-commission-financials.ts";

function historyRow(
  end: string | null,
  income: number | null,
  expenditure: number | null,
  breakdown: Partial<CharityFinancialHistoryItem> = {},
): CharityFinancialHistoryItem {
  return {
    ar_cycle_reference: null,
    financial_period_end_date: end,
    income,
    expenditure,
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
    ...breakdown,
  };
}

function latestYear(overrides: {
  periodStart: string | null;
  periodEnd: string | null;
  totalIncome: number | null;
  totalExpenditure: number | null;
}) {
  return {
    registeredNumber: "202918",
    registeredOn: "1965-09-07",
    reportingStatus: "Submission Received",
    ...overrides,
  };
}

describe("buildFinancialPeriods", () => {
  it("tiles consecutive years so each start is the previous end plus a day", () => {
    const rows = buildFinancialPeriods({
      history: [
        historyRow("2023-03-31", 100_000, 90_000),
        historyRow("2024-03-31", 120_000, 110_000),
      ],
      latest: null,
    });

    assert.equal(rows.length, 2);
    // Oldest row has no predecessor: the ordinary twelve-month year.
    assert.deepEqual(
      { start: rows[0].periodStart, end: rows[0].periodEnd },
      { start: "2022-04-01", end: "2023-03-31" },
    );
    assert.deepEqual(
      { start: rows[1].periodStart, end: rows[1].periodEnd },
      { start: "2023-04-01", end: "2024-03-31" },
    );
  });

  it("follows a changed year-end instead of assuming twelve months", () => {
    const rows = buildFinancialPeriods({
      history: [
        historyRow("2023-03-31", 100_000, 90_000),
        historyRow("2024-06-30", 120_000, 110_000),
      ],
      latest: null,
    });

    // 15-month period: within the tiling window, so the start still comes from
    // the previous end rather than from a fixed year subtraction.
    assert.equal(rows[1].periodStart, "2023-04-01");
    assert.equal(rows[1].periodEnd, "2024-06-30");
  });

  it("does not tile across a filing gap wider than eighteen months", () => {
    const rows = buildFinancialPeriods({
      history: [
        historyRow("2019-03-31", 100_000, 90_000),
        historyRow("2024-03-31", 120_000, 110_000),
      ],
      latest: null,
    });

    assert.equal(rows[1].periodStart, "2023-04-01");
  });

  it("prefers the details endpoint's published start for the latest year", () => {
    const rows = buildFinancialPeriods({
      history: [historyRow("2025-03-31", 339_366_903, 362_636_196)],
      latest: latestYear({
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        totalIncome: 339_366_903,
        totalExpenditure: 362_636_196,
      }),
    });

    assert.equal(rows.length, 1, "the same year must not be written twice");
    assert.equal(rows[0].periodStart, "2024-04-01");
    assert.equal(rows[0].incomeBand, "over_1m");
  });

  it("fills a figure the details endpoint is missing from the history row", () => {
    const rows = buildFinancialPeriods({
      history: [historyRow("2025-03-31", 500_000, 480_000)],
      latest: latestYear({
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        totalIncome: null,
        totalExpenditure: 470_000,
      }),
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].totalIncome, 500_000);
    assert.equal(rows[0].totalExpenditure, 470_000);
  });

  it("keeps a period that carries only one of the two figures", () => {
    const rows = buildFinancialPeriods({
      history: [historyRow("2024-03-31", 40_000, null)],
      latest: null,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].totalExpenditure, null);
    assert.equal(rows[0].incomeBand, "10k_100k");
  });

  it("drops a period with no figures at all", () => {
    const rows = buildFinancialPeriods({
      history: [historyRow("2024-03-31", null, null)],
      latest: null,
    });

    assert.deepEqual(rows, []);
  });

  it("still tiles the following year across a dropped empty period", () => {
    const rows = buildFinancialPeriods({
      history: [
        historyRow("2023-03-31", null, null),
        historyRow("2024-03-31", 10_000, 9_000),
      ],
      latest: null,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].periodStart, "2023-04-01");
  });

  it("ignores history rows with no period end date", () => {
    const rows = buildFinancialPeriods({
      history: [historyRow(null, 1, 1)],
      latest: null,
    });

    assert.deepEqual(rows, []);
  });

  it("keeps the first of two returns naming the same period end", () => {
    const rows = buildFinancialPeriods({
      history: [
        historyRow("2024-03-31", 100_000, 90_000),
        historyRow("2024-03-31", 111_111, 99_999),
      ],
      latest: null,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].totalIncome, 100_000);
  });

  it("writes the latest year even when there is no history at all", () => {
    const rows = buildFinancialPeriods({
      history: [],
      latest: latestYear({
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        totalIncome: 5_000,
        totalExpenditure: null,
      }),
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].incomeBand, "under_10k");
  });

  it("carries the register's breakdown through untouched", () => {
    const rows = buildFinancialPeriods({
      history: [
        historyRow("2024-03-31", 100_000, 90_000, {
          incomeGovtGrants: 40_000,
          incomeGovtContracts: 5_000,
          incomeDonationsLegacies: 55_000,
          expenditureRaisingFunds: 10_000,
        }),
      ],
      latest: null,
    });

    assert.equal(rows[0].incomeGovtGrants, 40_000);
    assert.equal(rows[0].incomeGovtContracts, 5_000);
    assert.equal(rows[0].incomeDonationsLegacies, 55_000);
    assert.equal(rows[0].expenditureRaisingFunds, 10_000);
    // Nothing is inferred from the parts: an unpublished part stays null rather
    // than becoming a zero the register never claimed.
    assert.equal(rows[0].incomeInvestment, null);
  });

  it("keeps the history row's breakdown on the year the details endpoint overwrites", () => {
    const rows = buildFinancialPeriods({
      history: [
        historyRow("2025-03-31", 500_000, 480_000, { incomeGovtGrants: 120_000 }),
      ],
      latest: latestYear({
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        totalIncome: 505_000,
        totalExpenditure: 480_000,
      }),
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].totalIncome, 505_000, "details wins on the totals");
    assert.equal(rows[0].incomeGovtGrants, 120_000, "history keeps the parts");
  });

  it("returns rows oldest first", () => {
    const rows = buildFinancialPeriods({
      history: [
        historyRow("2025-03-31", 3, 3),
        historyRow("2023-03-31", 1, 1),
        historyRow("2024-03-31", 2, 2),
      ],
      latest: null,
    });

    assert.deepEqual(
      rows.map((row) => row.periodEnd),
      ["2023-03-31", "2024-03-31", "2025-03-31"],
    );
  });
});
