import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeSpendEfficiency } from "./spend-efficiency.ts";

describe("computeSpendEfficiency", () => {
  it("returns null when periods array is empty or lacks breakdown", () => {
    assert.equal(computeSpendEfficiency([]), null);
    assert.equal(
      computeSpendEfficiency([
        {
          period_start: "2023-04-01",
          period_end: "2024-03-31",
          total_income: 100000,
          total_expenditure: 90000,
        },
      ]),
      null,
    );
  });

  it("calculates high efficiency when charitable spend >= 80%", () => {
    const summary = computeSpendEfficiency([
      {
        period_start: "2023-04-01",
        period_end: "2024-03-31",
        total_income: 1000000,
        total_expenditure: 1000000,
        expenditure_charitable_activities: 840000,
        expenditure_raising_funds: 110000,
        expenditure_governance: 50000,
      },
    ]);

    assert.ok(summary);
    assert.equal(summary.charitablePence, 84);
    assert.equal(summary.fundraisingPence, 11);
    assert.equal(summary.governancePence, 5);
    assert.equal(summary.category, "high_efficiency");
    assert.equal(summary.tone, "go");
    assert.equal(summary.yearLabel, "FY24");
  });

  it("identifies high fundraising cost when fundraising >= 20%", () => {
    const summary = computeSpendEfficiency([
      {
        period_start: "2023-04-01",
        period_end: "2024-03-31",
        total_income: 1000000,
        total_expenditure: 1000000,
        expenditure_charitable_activities: 720000,
        expenditure_raising_funds: 230000,
        expenditure_governance: 50000,
      },
    ]);

    assert.ok(summary);
    assert.equal(summary.fundraisingPence, 23);
    assert.equal(summary.category, "high_fundraising_cost");
    assert.equal(summary.tone, "hold");
  });

  it("picks the newest year that has breakdown data", () => {
    const summary = computeSpendEfficiency([
      {
        period_start: "2024-04-01",
        period_end: "2025-03-31",
        total_income: 50000,
        total_expenditure: 48000,
        // No breakdown in 2025
      },
      {
        period_start: "2023-04-01",
        period_end: "2024-03-31",
        total_income: 500000,
        total_expenditure: 450000,
        expenditure_charitable_activities: 360000,
        expenditure_raising_funds: 67500,
        expenditure_governance: 22500,
      },
    ]);

    assert.ok(summary);
    assert.equal(summary.yearLabel, "FY24");
    assert.equal(summary.charitablePence, 80);
    assert.equal(summary.fundraisingPence, 15);
  });
});
