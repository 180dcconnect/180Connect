import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scoreByPartnershipHistory } from "./score-by-partnership-history.ts";

describe("scoreByPartnershipHistory — complete client data", () => {
  it("scores a client with matched grant history above the no-history score", () => {
    const withHistory = scoreByPartnershipHistory(3);
    const noHistory = scoreByPartnershipHistory(0);
    assert.ok(withHistory.score > noHistory.score);
    assert.equal(withHistory.hasMatchedHistory, true);
  });

  it("more matched grants scores at least as high as fewer", () => {
    const few = scoreByPartnershipHistory(1);
    const many = scoreByPartnershipHistory(5);
    assert.ok(many.score >= few.score);
  });

  it("caps the bonus rather than scoring unboundedly for very high counts", () => {
    const capped = scoreByPartnershipHistory(5);
    const wayAbove = scoreByPartnershipHistory(500);
    assert.equal(capped.score, wayAbove.score);
  });
});

describe("scoreByPartnershipHistory — missing scoring inputs (AC2)", () => {
  it("treats null (never matched) the same as 0 (matched, found none)", () => {
    const neverChecked = scoreByPartnershipHistory(null);
    const checkedNone = scoreByPartnershipHistory(0);
    assert.equal(neverChecked.score, checkedNone.score);
    assert.equal(neverChecked.hasMatchedHistory, false);
    assert.equal(checkedNone.hasMatchedHistory, false);
  });

  it("treats undefined the same way", () => {
    const result = scoreByPartnershipHistory(undefined);
    assert.equal(result.hasMatchedHistory, false);
  });

  it("no-history is not a penalty — scores at the same neutral value other parameters use for missing data", () => {
    const result = scoreByPartnershipHistory(null);
    assert.equal(result.score, 0.5);
  });

  it("does not treat missing history as worse than the lowest matched-history score", () => {
    const noHistory = scoreByPartnershipHistory(null);
    const oneGrant = scoreByPartnershipHistory(1);
    assert.ok(noHistory.score <= oneGrant.score);
  });
});

describe("scoreByPartnershipHistory — invalid input", () => {
  it("treats NaN the same as no history", () => {
    const result = scoreByPartnershipHistory(NaN);
    assert.equal(result.hasMatchedHistory, false);
  });

  it("treats a negative count the same as no history", () => {
    const result = scoreByPartnershipHistory(-2);
    assert.equal(result.hasMatchedHistory, false);
  });
});
