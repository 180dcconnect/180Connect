import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculatePriorityScore,
  DEFAULT_WEIGHTS,
  sanitizeWeights,
  type PriorityFactors,
} from "./calculate-priority-score.ts";

const perfect: PriorityFactors = {
  sector: 1,
  geography: 1,
  size: 1,
  partnershipHistory: 1,
  previousContact: 1,
};

const zero: PriorityFactors = {
  sector: 0,
  geography: 0,
  size: 0,
  partnershipHistory: 0,
  previousContact: 0,
};

describe("calculatePriorityScore — boundary cases", () => {
  it("returns 1 when every factor is a perfect 1", () => {
    assert.equal(calculatePriorityScore(perfect), 1);
  });

  it("returns 0 when every factor is 0", () => {
    assert.equal(calculatePriorityScore(zero), 0);
  });

  it("returns 0.5 for equal, mid-range factors under equal weighting", () => {
    const mid: PriorityFactors = {
      sector: 0.5,
      geography: 0.5,
      size: 0.5,
      partnershipHistory: 0.5,
      previousContact: 0.5,
    };
    assert.equal(calculatePriorityScore(mid), 0.5);
  });
});

describe("calculatePriorityScore — weighting (F096)", () => {
  it("defaults to DEFAULT_WEIGHTS, which sum to 1 across five parameters", () => {
    const sum =
      DEFAULT_WEIGHTS.sector +
      DEFAULT_WEIGHTS.geography +
      DEFAULT_WEIGHTS.size +
      DEFAULT_WEIGHTS.partnershipHistory +
      DEFAULT_WEIGHTS.previousContact;
    assert.equal(sum, 1);
  });

  it("weights each factor equally under the default", () => {
    // Maxing out just one factor while the rest are 0 should equal that
    // factor's own weight, confirming no factor is silently favoured.
    const onlySector = calculatePriorityScore({ ...zero, sector: 1 });
    const onlyGeography = calculatePriorityScore({ ...zero, geography: 1 });
    const onlyPartnership = calculatePriorityScore({ ...zero, partnershipHistory: 1 });
    assert.equal(onlySector, DEFAULT_WEIGHTS.sector);
    assert.equal(onlyGeography, DEFAULT_WEIGHTS.geography);
    assert.equal(onlyPartnership, DEFAULT_WEIGHTS.partnershipHistory);
    assert.equal(onlySector, onlyGeography);
  });

  it("honours custom weights passed by the caller (the F096 write path)", () => {
    // Weights summing to 1: a sector-only factor scores exactly sector's weight.
    const weights = {
      sector: 0.4,
      geography: 0.15,
      size: 0.15,
      partnershipHistory: 0.15,
      previousContact: 0.15,
    };
    assert.equal(
      calculatePriorityScore({ ...zero, sector: 1 }, weights),
      0.4,
    );
    // Zeroing a factor's weight removes it entirely: an unweighted set of
    // perfect factors cannot rescue a maxed-out factor scoring 0.
    const allOnSector = { sector: 1, geography: 0, size: 0, partnershipHistory: 0, previousContact: 0 };
    assert.equal(
      calculatePriorityScore({ ...perfect, sector: 0 }, allOnSector),
      0,
    );
  });

  it("normalises weights that do not sum to 1 instead of leaving the 0-1 range", () => {
    // All factors at 1 under any positive weights must still produce exactly 1.
    const lopsided = { sector: 3, geography: 1, size: 1, partnershipHistory: 1, previousContact: 1 };
    assert.equal(calculatePriorityScore(perfect, lopsided), 1);
    // And a single factor's share reflects its slice of the total weight.
    assert.equal(
      calculatePriorityScore({ ...zero, geography: 1 }, lopsided),
      1 / 7,
    );
  });

  it("returns 0 rather than NaN when every weight is 0", () => {
    const allZero = { sector: 0, geography: 0, size: 0, partnershipHistory: 0, previousContact: 0 };
    assert.equal(calculatePriorityScore(perfect, allZero), 0);
  });
});

describe("sanitizeWeights — untrusted config input (F096)", () => {
  it("passes clean weights through unchanged", () => {
    const clean = { sector: 0.5, geography: 0.2, size: 0.1, partnershipHistory: 0.1, previousContact: 0.1 };
    assert.deepEqual(sanitizeWeights(clean), clean);
  });

  it("falls back per-key to the default for missing keys (SCOUT v1 predates partnershipHistory)", () => {
    const v1 = { sector: 0.25, geography: 0.25, size: 0.25, previousContact: 0.25 };
    const result = sanitizeWeights(v1);
    assert.equal(result.partnershipHistory, DEFAULT_WEIGHTS.partnershipHistory);
    assert.equal(result.sector, 0.25);
  });

  it("clamps out-of-range and replaces non-numeric values with defaults", () => {
    const result = sanitizeWeights({
      sector: 7,
      geography: -1,
      size: "big",
      partnershipHistory: null,
      previousContact: NaN,
    });
    assert.equal(result.sector, 1);
    assert.equal(result.geography, 0);
    assert.equal(result.size, DEFAULT_WEIGHTS.size);
    assert.equal(result.partnershipHistory, DEFAULT_WEIGHTS.partnershipHistory);
    assert.equal(result.previousContact, DEFAULT_WEIGHTS.previousContact);
  });

  it("degrades a non-object to all defaults rather than throwing", () => {
    assert.deepEqual(sanitizeWeights(null), DEFAULT_WEIGHTS);
    assert.deepEqual(sanitizeWeights("nonsense"), DEFAULT_WEIGHTS);
    assert.deepEqual(sanitizeWeights(undefined), DEFAULT_WEIGHTS);
  });
});

describe("calculatePriorityScore — defensive clamping", () => {
  it("clamps a factor above 1 down to 1 rather than exceeding the 0-1 range", () => {
    const result = calculatePriorityScore({ ...perfect, sector: 5 });
    assert.equal(result, 1);
  });

  it("clamps a negative factor up to 0 rather than producing a negative score", () => {
    const result = calculatePriorityScore({ ...zero, sector: -3 });
    assert.equal(result, 0);
  });

  it("treats NaN as 0 rather than propagating NaN through the result", () => {
    const result = calculatePriorityScore({ ...zero, sector: NaN });
    assert.equal(result, 0);
  });
});
