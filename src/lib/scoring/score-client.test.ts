import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bandForScore,
  computePriorityScore,
  latestTotalIncome,
  PRIORITY_BAND_THRESHOLDS,
  priorityFactorsFor,
} from "./score-client.ts";
import { DEFAULT_WEIGHTS } from "./calculate-priority-score.ts";

describe("bandForScore — thresholds pending team confirmation", () => {
  it("bands 0.70 and above high (boundary inclusive)", () => {
    assert.equal(bandForScore(PRIORITY_BAND_THRESHOLDS.high), "high");
    assert.equal(bandForScore(1), "high");
  });

  it("bands 0.40–0.70 medium, boundaries inclusive to medium", () => {
    assert.equal(bandForScore(PRIORITY_BAND_THRESHOLDS.medium), "medium");
    assert.equal(bandForScore(0.6999), "medium");
  });

  it("bands below 0.40 low", () => {
    assert.equal(bandForScore(0.39), "low");
    assert.equal(bandForScore(0), "low");
  });
});

describe("latestTotalIncome", () => {
  const fp = (total_income: number | null, period_end: string) => ({
    total_income,
    period_end,
  });

  it("takes the most recent period's income, not the first in the array", () => {
    const org = {
      financial_periods: [fp(50_000, "2024-03-31"), fp(90_000, "2025-03-31")],
    };
    assert.equal(latestTotalIncome(org), 90_000);
  });

  it("falls back to an older period when the newest has no income", () => {
    const org = {
      financial_periods: [fp(null, "2025-03-31"), fp(20_000, "2023-03-31")],
    };
    assert.equal(latestTotalIncome(org), 20_000);
  });

  it("falls back to the org-level total_income when there are no periods", () => {
    assert.equal(latestTotalIncome({ total_income: 12_000 }), 12_000);
  });

  it("returns null when nothing anywhere carries an income", () => {
    assert.equal(latestTotalIncome({}), null);
    assert.equal(
      latestTotalIncome({ financial_periods: [fp(null, "2024-01-01")] }),
      null,
    );
  });
});

describe("priorityFactorsFor — factor coverage matches the header's honesty table", () => {
  it("feeds the recorded sector into the sector factor (F089 wired in)", () => {
    // A taxonomy match carries real ranking signal, not the neutral.
    const matched = priorityFactorsFor({
      sector: "Health & Social Care",
      outreach_status: "not_contacted",
    });
    assert.equal(matched.sector, 0.7);
  });

  it("keeps sector at the explicit neutral when no usable value exists", () => {
    // Missing/blank sector: the scorer's documented AC3 default — unknown
    // neither gains nor loses. Free text matching nothing lands here too.
    assert.equal(priorityFactorsFor({ outreach_status: "not_contacted" }).sector, 0.5);
    assert.equal(priorityFactorsFor({ sector: "  ", outreach_status: "not_contacted" }).sector, 0.5);
    assert.equal(
      priorityFactorsFor({ sector: "Completely Unclassified Trust", outreach_status: "not_contacted" })
        .sector,
      0.5,
    );
  });

  it("changes the score when a client's sector is added or reclassified", () => {
    const unscored = computePriorityScore({ outreach_status: "converted" }).score;
    const health = computePriorityScore({
      sector: "Mental Health",
      outreach_status: "converted",
    }).score;
    const arts = computePriorityScore({
      sector: "Arts & Culture",
      outreach_status: "converted",
    }).score;
    assert.ok(health > arts); // taxonomy ranks Health & Wellbeing above Arts
    assert.ok(health > unscored); // adding a strong sector must move the score
  });

  it("keeps geography neutral while no branch priority regions exist", () => {
    assert.equal(
      priorityFactorsFor({ city: "Leeds", outreach_status: "not_contacted" }).geography,
      0.5,
    );
  });

  it("sharpens geography the day a caller passes priority regions", () => {
    const factors = priorityFactorsFor(
      { city: "Leeds", outreach_status: "not_contacted" },
      ["leeds"],
    );
    assert.ok(factors.geography > 0.5);
    assert.equal(
      priorityFactorsFor({ city: "Hull", outreach_status: "not_contacted" }, ["leeds"])
        .geography < 0.5,
      true,
    );
  });

  it("maps warmer pipeline statuses to a higher previous-contact factor (F093)", () => {
    const warm = priorityFactorsFor({ outreach_status: "responded" }).previousContact;
    const cold = priorityFactorsFor({ outreach_status: "hard_no" }).previousContact;
    assert.ok(warm > cold);
    // F093 ideology: converted is gold, and never-contacted outranks every
    // negative or unresolved outreach state.
    assert.equal(
      priorityFactorsFor({ outreach_status: "converted" }).previousContact,
      1.0,
    );
    const untouched = priorityFactorsFor({ outreach_status: "not_contacted" })
      .previousContact;
    assert.ok(untouched > cold);
    // A status the scorer has never heard of degrades to neutral rather than
    // throwing or silently scoring as fully-engaged.
    assert.equal(priorityFactorsFor({ outreach_status: "mystery" }).previousContact, 0.5);
  });

  it("feeds last-contact recency into the previous-contact factor (F093 AC1)", () => {
    const stale = priorityFactorsFor({
      outreach_status: "follow_up_sent",
      last_contacted_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    }).previousContact;
    const fresh = priorityFactorsFor({
      outreach_status: "follow_up_sent",
      last_contacted_at: new Date().toISOString(),
    }).previousContact;
    // A client chased very recently must score below one whose chase went stale.
    assert.ok(fresh < stale);
  });
});

describe("computePriorityScore", () => {
  it("agrees with calculatePriorityScore over DEFAULT_WEIGHTS", () => {
    const org = {
      city: null,
      outreach_status: "initial_outreach_sent",
      financial_periods: [{ total_income: 250_000, period_end: "2025-03-31" }],
      matched_grant_count: null,
    };
    const factors = priorityFactorsFor(org);
    const manual =
      factors.sector * DEFAULT_WEIGHTS.sector +
      factors.geography * DEFAULT_WEIGHTS.geography +
      factors.size * DEFAULT_WEIGHTS.size +
      factors.partnershipHistory * DEFAULT_WEIGHTS.partnershipHistory +
      factors.previousContact * DEFAULT_WEIGHTS.previousContact;
    assert.equal(computePriorityScore(org).score, manual);
  });

  it("scores under caller-supplied weights (the F096 reweight path)", () => {
    const org = {
      outreach_status: "converted",
      financial_periods: [{ total_income: 2_000_000, period_end: "2025-03-31" }],
    };
    // All weight on previous contact must collapse the score onto that factor.
    const allPrevious = { sector: 0, geography: 0, size: 0, partnershipHistory: 0, previousContact: 1 };
    assert.equal(
      computePriorityScore(org, [], allPrevious).score,
      priorityFactorsFor(org).previousContact,
    );
  });

  it("feeds matched grant history into the partnership-history factor", () => {
    const withHistory = priorityFactorsFor({ outreach_status: "not_contacted", matched_grant_count: 4 });
    const without = priorityFactorsFor({ outreach_status: "not_contacted", matched_grant_count: null });
    assert.ok(withHistory.partnershipHistory > without.partnershipHistory);
    // No history is the scorer's neutral, not a penalty.
    assert.equal(without.partnershipHistory, 0.5);
  });

  it("produces the documented band alongside the score", () => {
    const engaged = computePriorityScore({
      outreach_status: "converted",
      financial_periods: [{ total_income: 2_000_000, period_end: "2025-03-31" }],
    });
    assert.equal(engaged.band, bandForScore(engaged.score));

    const untouched = computePriorityScore({
      outreach_status: "hard_no",
    });
    assert.equal(untouched.band, bandForScore(untouched.score));
  });

  it("never throws on an organisation with no scoring data at all", () => {
    const result = computePriorityScore({ outreach_status: "not_contacted" });
    assert.ok(result.score >= 0 && result.score <= 1);
  });

  it("scores a fully engaged large organisation above a cold small one", () => {
    const strong = computePriorityScore({
      outreach_status: "converted",
      financial_periods: [{ total_income: 5_000_000, period_end: "2025-03-31" }],
    });
    const weak = computePriorityScore({
      outreach_status: "hard_no",
      financial_periods: [{ total_income: 5_000, period_end: "2025-03-31" }],
    });
    assert.ok(strong.score > weak.score);
  });
});
