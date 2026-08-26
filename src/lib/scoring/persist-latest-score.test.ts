import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculatePriorityScore, DEFAULT_WEIGHTS } from "./calculate-priority-score.ts";
import { computePriorityScore } from "./score-client.ts";
import { persistLatestScore, type ScoreFactorsRecord } from "./persist-latest-score.ts";

/**
 * A capture-double for the structural UpsertDb slice: records every upsert
 * payload so assertions can inspect exactly what would land in LATEST_SCORES.
 */
function capturingDb() {
  const upserts: Record<string, unknown>[] = [];
  return {
    upserts,
    from(_table: string) {
      return {
        upsert(row: Record<string, unknown>, _options: { onConflict: string }) {
          upserts.push(row);
          return {
            select(_columns: string) {
              return Promise.resolve({ data: [{ id: "row-1" }], error: null });
            },
          };
        },
      };
    },
  };
}

describe("persistLatestScore — score_factors payload (F095)", () => {
  it("stores the per-factor inputs alongside the score", async () => {
    const db = capturingDb();
    const result = await persistLatestScore(
      db,
      "org-1",
      {
        sector: "Mental Health",
        outreach_status: "converted",
        financial_periods: [{ total_income: 250_000, period_end: "2025-03-31" }],
        matched_grant_count: 2,
      },
      DEFAULT_WEIGHTS,
    );
    assert.equal(result.ok, true);
    assert.equal(db.upserts.length, 1);

    const row = db.upserts[0];
    const stored = row.score_factors as ScoreFactorsRecord;

    // All five factors present, each a normalised number.
    for (const key of [
      "sector",
      "geography",
      "size",
      "partnershipHistory",
      "previousContact",
    ] as const) {
      assert.ok(
        typeof stored.factors[key] === "number" &&
          stored.factors[key] >= 0 &&
          stored.factors[key] <= 1,
        `factor ${key} should be a 0-1 number`,
      );
    }

    // The weights snapshot is what was actually applied.
    assert.deepEqual(stored.weights, DEFAULT_WEIGHTS);
    // The SQL shape guard (migration 20260905100000) requires both keys.
    assert.ok("factors" in stored && "weights" in stored);
  });

  it("AC3 — the stored breakdown reproduces the stored priority_score exactly", async () => {
    const org = {
      city: "Sheffield",
      sector: "Poverty Relief",
      outreach_status: "follow_up_sent",
      last_contacted_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      financial_periods: [{ total_income: 90_000, period_end: "2025-03-31" }],
      matched_grant_count: null,
    };
    // Reweighted config, not just defaults: consistency must survive F096 edits.
    const weights = { sector: 0.3, geography: 0.1, size: 0.15, partnershipHistory: 0.25, previousContact: 0.2 };

    const db = capturingDb();
    const result = await persistLatestScore(db, "org-1", org, weights);
    assert.equal(result.ok, true);

    const row = db.upserts[0];
    const stored = row.score_factors as ScoreFactorsRecord;
    const reproduced = calculatePriorityScore(stored.factors, stored.weights);

    assert.equal(row.priority_score, result.ok && result.score);
    assert.equal(reproduced, row.priority_score);
    assert.equal(computePriorityScore(org, [], weights).score, row.priority_score);
  });
});
