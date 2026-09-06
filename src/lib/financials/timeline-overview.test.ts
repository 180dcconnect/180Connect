import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateTimelineOverviewPoints } from "./timeline-overview.ts";
import type { FinancialYear } from "./financial-series.ts";

const mockYear = (label: string, income: number, expenditure: number, net: number): FinancialYear => ({
  label,
  periodStart: `${label}-01-01`,
  periodEnd: `${label}-12-31`,
  income,
  expenditure,
  net,
  incomeBand: "100k_1m",
  filedOn: null,
  grantTotal: 0,
  grantShare: 0,
  grantsExcluded: 0,
  mix: [],
  mixDetail: [],
  spend: [],
  spendDetail: [],
  employees: null,
  volunteers: null,
  governmentIncome: null,
  governmentShare: null,
  governmentAwards: null,
  receivesGovernmentGrants: null,
  receivesGovernmentContracts: null,
});

describe("calculateTimelineOverviewPoints", () => {
  it("returns empty result when fewer than 2 years exist", () => {
    const result = calculateTimelineOverviewPoints([], "income");
    assert.equal(result.curvePoints.length, 0);
    assert.equal(result.splineLine, "");
  });

  it("calculates income trajectory points mapped within bounds", () => {
    const years = [
      mockYear("2021", 100_000, 90_000, 10_000),
      mockYear("2022", 150_000, 130_000, 20_000),
      mockYear("2023", 200_000, 190_000, 10_000),
    ];

    const result = calculateTimelineOverviewPoints(years, "income");

    assert.equal(result.curvePoints.length, 3);
    assert.equal(result.zeroYPercent, null);
    assert.ok(result.splineLine.startsWith("M "));
    assert.ok(result.splineFill.includes("Z"));

    // Higher income should have lower y coordinate (higher in SVG canvas)
    assert.ok(result.curvePoints[2].y < result.curvePoints[0].y);
    assert.ok(result.curvePoints[1].y < result.curvePoints[0].y);
  });

  it("calculates net result points with zero baseline and distinct surplus/deficit positions", () => {
    const years = [
      mockYear("2021", 100_000, 80_000, 20_000), // Surplus -> above baseline (y < 48)
      mockYear("2022", 100_000, 100_000, 0),     // Zero -> on baseline (y = 48)
      mockYear("2023", 100_000, 120_000, -20_000), // Deficit -> below baseline (y > 48)
    ];

    const result = calculateTimelineOverviewPoints(years, "net");

    assert.equal(result.curvePoints.length, 3);
    assert.equal(result.zeroYPercent, 48);

    const [surplusPt, zeroPt, deficitPt] = result.curvePoints;
    assert.ok(surplusPt.y < 48, "Surplus point should be above baseline");
    assert.equal(zeroPt.y, 48, "Zero point should be exactly on baseline");
    assert.ok(deficitPt.y > 48, "Deficit point should be below baseline");
  });
});
