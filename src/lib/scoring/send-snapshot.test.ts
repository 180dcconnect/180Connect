import assert from "node:assert/strict";
import { test } from "node:test";

import { assembleScoreSnapshot } from "./send-snapshot.ts";
import { DEFAULT_WEIGHTS } from "./calculate-priority-score.ts";

const fullConfig = {
  weights: DEFAULT_WEIGHTS,
  version: "v2",
  id: "00000000-0000-4000-9000-000000000001",
  degraded: false,
};

test("assembles the five factors plus score and band from org data", () => {
  const payload = assembleScoreSnapshot(
    {
      city: "Sheffield",
      sector: null,
      outreach_status: "not_contacted",
      total_income: 250_000,
      financial_periods: [],
      matched_grant_count: 3,
    },
    fullConfig,
  );

  // Sector is the documented neutral until F089 lands.
  assert.equal(payload.sector, 0.5);
  // No priority regions configured → the geography neutral (0.5), whatever
  // the city — "no preference set" must not penalise a recorded location.
  assert.equal(payload.geography, 0.5);
  assert.ok(payload.size > 0 && payload.size <= 1);
  // Matched grants sit between the no-history neutral and the max bonus.
  assert.ok(
    payload.partnership_history > 0.5 && payload.partnership_history <= 0.9,
  );
  assert.ok(payload.previous_contact >= 0 && payload.previous_contact <= 1);

  // Score is the weighted combination of those exact factors — recompute and
  // compare so the snapshot can never disagree with the live engine.
  const expected =
    (payload.sector * DEFAULT_WEIGHTS.sector +
      payload.geography * DEFAULT_WEIGHTS.geography +
      payload.size * DEFAULT_WEIGHTS.size +
      payload.partnership_history * DEFAULT_WEIGHTS.partnershipHistory +
      payload.previous_contact * DEFAULT_WEIGHTS.previousContact) /
    (DEFAULT_WEIGHTS.sector +
      DEFAULT_WEIGHTS.geography +
      DEFAULT_WEIGHTS.size +
      DEFAULT_WEIGHTS.partnershipHistory +
      DEFAULT_WEIGHTS.previousContact);
  assert.equal(payload.priority_score, closeTo(expected));
  assert.equal(payload.priority_band, bandOf(expected));
  assert.equal(payload.model_version_id, fullConfig.id);
});

test("a degraded config cites no model version rather than a wrong one", () => {
  const payload = assembleScoreSnapshot(
    {
      outreach_status: "not_contacted",
      total_income: null,
    },
    { ...fullConfig, degraded: true, id: null },
  );
  assert.equal(payload.model_version_id, null);
});

test("missing inputs degrade to documented neutrals, never throw", () => {
  const payload = assembleScoreSnapshot(
    { outreach_status: "not_contacted" },
    fullConfig,
  );
  assert.equal(payload.sector, 0.5);
  assert.equal(payload.partnership_history, 0.5); // scorer's no-history neutral
  assert.ok(payload.priority_score >= 0 && payload.priority_score <= 1);
});

function closeTo(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function bandOf(score: number): "high" | "medium" | "low" {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}
