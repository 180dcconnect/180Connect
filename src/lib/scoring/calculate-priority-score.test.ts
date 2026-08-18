import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculatePriorityScore,
  PLACEHOLDER_WEIGHTS,
  type PriorityFactors,
} from "./calculate-priority-score.ts";

const perfect: PriorityFactors = {
  sector: 1,
  geography: 1,
  size: 1,
  previousContact: 1,
};

const zero: PriorityFactors = {
  sector: 0,
  geography: 0,
  size: 0,
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
      previousContact: 0.5,
    };
    assert.equal(calculatePriorityScore(mid), 0.5);
  });
});

describe("calculatePriorityScore — weighting", () => {
  it("uses PLACEHOLDER_WEIGHTS, which sum to 1", () => {
    const sum =
      PLACEHOLDER_WEIGHTS.sector +
      PLACEHOLDER_WEIGHTS.geography +
      PLACEHOLDER_WEIGHTS.size +
      PLACEHOLDER_WEIGHTS.previousContact;
    assert.equal(sum, 1);
  });

  it("weights each factor equally (placeholder, per the ticket's open question)", () => {
    // Maxing out just one factor while the rest are 0 should equal that
    // factor's own weight, confirming no factor is silently favoured.
    const onlySector = calculatePriorityScore({ ...zero, sector: 1 });
    const onlyGeography = calculatePriorityScore({ ...zero, geography: 1 });
    assert.equal(onlySector, PLACEHOLDER_WEIGHTS.sector);
    assert.equal(onlyGeography, PLACEHOLDER_WEIGHTS.geography);
    assert.equal(onlySector, onlyGeography);
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