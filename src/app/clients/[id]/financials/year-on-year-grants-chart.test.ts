import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMonotoneSplinePath,
  extractGrantYearPoints,
} from "./year-on-year-grants-chart.tsx";
import { calculateNiceYAxis } from "./chart-parts.ts";
import type { FinancialSeries } from "@/lib/financials/financial-series.ts";

const mockSeries = (
  years: { label: string; grantTotal: number }[] = [],
  hasGrants = true,
): FinancialSeries => ({
  years: years.map((y) => ({
    label: y.label,
    periodStart: `${y.label}-01-01`,
    periodEnd: `${y.label}-12-31`,
    income: 100_000,
    expenditure: 90_000,
    net: 10_000,
    incomeBand: "100k-500k",
    filingDate: null,
    source: null,
    grantTotal: y.grantTotal,
    grantShare: 0.2,
    grantsExcluded: 0,
    mix: [],
    hasEmployees: false,
    employees: null,
    hasVolunteers: false,
    volunteers: null,
    governmentIncome: null,
    governmentShare: null,
    governmentAwards: null,
    receivesGovernmentGrants: null,
    receivesGovernmentContracts: null,
  })),
  peak: 100_000,
  peakNet: 10_000,
  hasGrants,
});

describe("extractGrantYearPoints", () => {
  it("groups raw grants by calendar year and identifies the top funder", () => {
    const grants = [
      {
        amount_awarded: 50_000,
        currency: "GBP",
        award_date: "2022-03-15",
        funder_name: "Trust A",
      },
      {
        amount_awarded: 25_000,
        currency: "GBP",
        award_date: "2022-07-20",
        funder_name: "Trust B",
      },
      {
        amount_awarded: 80_000,
        currency: "GBP",
        award_date: "2023-01-10",
        funder_name: "Foundation C",
      },
    ];

    const points = extractGrantYearPoints(mockSeries(), grants);

    assert.equal(points.length, 2);
    assert.deepEqual(points[0], {
      year: "2022",
      amount: 75_000,
      awardCount: 2,
      topFunder: "Trust A",
    });
    assert.deepEqual(points[1], {
      year: "2023",
      amount: 80_000,
      awardCount: 1,
      topFunder: "Foundation C",
    });
  });

  it("fills in intermediate gap years to preserve timeline honesty", () => {
    const grants = [
      {
        amount_awarded: 30_000,
        currency: "GBP",
        award_date: "2020-05-01",
        funder_name: "Trust A",
      },
      {
        amount_awarded: 60_000,
        currency: "GBP",
        award_date: "2023-09-01",
        funder_name: "Trust B",
      },
    ];

    const points = extractGrantYearPoints(mockSeries(), grants);

    assert.equal(points.length, 4);
    assert.equal(points[0].year, "2020");
    assert.equal(points[0].amount, 30_000);

    // 2021 and 2022 should be filled with 0 amount
    assert.equal(points[1].year, "2021");
    assert.equal(points[1].amount, 0);
    assert.equal(points[1].awardCount, 0);

    assert.equal(points[2].year, "2022");
    assert.equal(points[2].amount, 0);
    assert.equal(points[2].awardCount, 0);

    assert.equal(points[3].year, "2023");
    assert.equal(points[3].amount, 60_000);
  });

  it("ignores non-GBP grants and invalid dates", () => {
    const grants = [
      {
        amount_awarded: 100_000,
        currency: "USD",
        award_date: "2022-05-01",
        funder_name: "US Foundation",
      },
      {
        amount_awarded: 40_000,
        currency: "GBP",
        award_date: "2022-06-01",
        funder_name: "UK Trust",
      },
      {
        amount_awarded: 50_000,
        currency: "GBP",
        award_date: "invalid-date",
        funder_name: "UK Trust 2",
      },
      {
        amount_awarded: 60_000,
        currency: "GBP",
        award_date: "2023-01-01",
        funder_name: "UK Trust 3",
      },
    ];

    const points = extractGrantYearPoints(mockSeries(), grants);

    assert.equal(points.length, 2);
    assert.equal(points[0].year, "2022");
    assert.equal(points[0].amount, 40_000);
    assert.equal(points[1].year, "2023");
    assert.equal(points[1].amount, 60_000);
  });

  it("falls back to series.years if raw grants are unavailable", () => {
    const series = mockSeries(
      [
        { label: "FY21", grantTotal: 15_000 },
        { label: "FY22", grantTotal: 25_000 },
        { label: "FY23", grantTotal: 35_000 },
      ],
      true,
    );

    const points = extractGrantYearPoints(series, []);

    assert.equal(points.length, 3);
    assert.equal(points[0].year, "FY21");
    assert.equal(points[0].amount, 15_000);
    assert.equal(points[2].year, "FY23");
    assert.equal(points[2].amount, 35_000);
  });

  it("returns empty array if fewer than 2 points are available", () => {
    const grants = [
      {
        amount_awarded: 50_000,
        currency: "GBP",
        award_date: "2023-05-01",
        funder_name: "Trust A",
      },
    ];

    const points = extractGrantYearPoints(mockSeries([], false), grants);
    assert.equal(points.length, 0);
  });
});

describe("buildMonotoneSplinePath", () => {
  it("produces valid line and fill SVG commands", () => {
    const pts = [
      { x: 10, y: 80 },
      { x: 30, y: 50 },
      { x: 50, y: 20 },
      { x: 70, y: 40 },
      { x: 90, y: 10 },
    ];

    const { line, fill } = buildMonotoneSplinePath(pts);

    assert.ok(line.startsWith("M 10.00 80.00"));
    assert.ok(line.includes("C "));
    assert.ok(fill.includes("L 90.00 100 L 10.00 100 Z"));
  });

  it("handles single-point dataset gracefully", () => {
    const { line, fill } = buildMonotoneSplinePath([{ x: 50, y: 30 }]);
    assert.ok(line.startsWith("M 0 30.00"));
    assert.ok(fill.endsWith("Z"));
  });

  it("handles empty dataset gracefully", () => {
    const { line, fill } = buildMonotoneSplinePath([]);
    assert.equal(line, "");
    assert.equal(fill, "");
  });
});

describe("Y-axis graduation for YearOnYearGrantsChart", () => {
  it("calculates clean step sizes and zero baseline", () => {
    const yAxis = calculateNiceYAxis(185_000, 4);

    assert.ok(yAxis.max >= 185_000);
    assert.equal(yAxis.ticks[yAxis.ticks.length - 1], 0);
    // Ticks should be in strictly descending order
    for (let i = 0; i < yAxis.ticks.length - 1; i++) {
      assert.ok(yAxis.ticks[i] > yAxis.ticks[i + 1]);
    }
  });
});
