import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupByDay, groupByModel, type GenerationRecord } from "./generation-history.ts";

const FLASH_LITE: GenerationRecord = {
  model: "gemini-3.5-flash-lite",
  createdAt: "2026-08-19T10:00:00.000Z",
  totalTokens: 1000,
  costUsd: 0.05,
};
const FLASH_LATEST: GenerationRecord = {
  model: "gemini-flash-latest",
  createdAt: "2026-08-20T09:00:00.000Z",
  totalTokens: 2000,
  costUsd: 0.2,
};

describe("groupByModel", () => {
  it("counts, sums tokens/cost, and ranks by count by default", () => {
    const rows = [FLASH_LITE, FLASH_LITE, FLASH_LATEST];
    assert.deepEqual(groupByModel(rows), [
      {
        model: "gemini-3.5-flash-lite",
        count: 2,
        share: 2 / 3,
        totalTokens: 2000,
        hasUnknownTokens: false,
        totalCostUsd: 0.1,
        hasUnknownCost: false,
      },
      {
        model: "gemini-flash-latest",
        count: 1,
        share: 1 / 3,
        totalTokens: 2000,
        hasUnknownTokens: false,
        totalCostUsd: 0.2,
        hasUnknownCost: false,
      },
    ]);
  });

  it("re-ranks by cost when asked, even against the count order", () => {
    const rows = [FLASH_LITE, FLASH_LITE, FLASH_LATEST];
    const byCost = groupByModel(rows, "cost");
    assert.deepEqual(byCost.map((entry) => entry.model), ["gemini-flash-latest", "gemini-3.5-flash-lite"]);
  });

  it("flags a group as having unknown cost without silently treating it as free", () => {
    const rows: GenerationRecord[] = [FLASH_LITE, { ...FLASH_LITE, costUsd: null }];
    const [entry] = groupByModel(rows);
    assert.equal(entry.hasUnknownCost, true);
    assert.equal(entry.totalCostUsd, 0.05);
  });

  it("returns an empty breakdown, not a division error, for no rows", () => {
    assert.deepEqual(groupByModel([]), []);
  });
});

describe("groupByDay", () => {
  it("buckets by UTC calendar day and sorts ascending", () => {
    assert.deepEqual(groupByDay([FLASH_LATEST, FLASH_LITE], "count"), [
      { date: "2026-08-19", value: 1 },
      { date: "2026-08-20", value: 1 },
    ]);
  });

  it("sums the requested metric within a day rather than counting rows", () => {
    const rows = [FLASH_LITE, { ...FLASH_LITE, costUsd: 0.03 }];
    assert.deepEqual(groupByDay(rows, "cost"), [{ date: "2026-08-19", value: 0.08 }]);
  });

  it("treats a missing count as 0 rather than dropping the day", () => {
    const rows = [{ ...FLASH_LITE, totalTokens: null }];
    assert.deepEqual(groupByDay(rows, "tokens"), [{ date: "2026-08-19", value: 0 }]);
  });

  it("has no entry at all for a day with no generations", () => {
    assert.deepEqual(groupByDay([], "count"), []);
  });
});
