import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCostUsd } from "./generation-cost.ts";

const RATE = { inputUsdPer1kTokens: 0.1, outputUsdPer1kTokens: 0.4 };

describe("computeCostUsd", () => {
  it("prices input and output tokens against the given rate", () => {
    // 1000 input @ 0.1/1k = 0.1, 500 output @ 0.4/1k = 0.2 -> 0.3
    assert.equal(computeCostUsd({ inputTokens: 1000, outputTokens: 500 }, RATE), 0.3);
  });

  it("returns null, not 0, when no rate is configured for the model", () => {
    assert.equal(computeCostUsd({ inputTokens: 1000, outputTokens: 500 }, null), null);
  });

  it("returns null, not 0, when the provider reported no usage at all", () => {
    assert.equal(computeCostUsd({ inputTokens: null, outputTokens: undefined }, RATE), null);
  });

  it("prices the side it has when only one usage count is reported", () => {
    assert.equal(computeCostUsd({ inputTokens: 1000, outputTokens: null }, RATE), 0.1);
  });

  it("rounds to 6 decimal places, matching the numeric(12,6) column", () => {
    const cost = computeCostUsd({ inputTokens: 1, outputTokens: 1 }, { inputUsdPer1kTokens: 0.0000001, outputUsdPer1kTokens: 0 });
    assert.equal(cost, 0);
  });
});
