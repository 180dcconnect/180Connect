import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scoreByGeography } from "./score-by-geography.ts";

const PRIORITY_REGIONS = ["London", "Manchester"];

describe("scoreByGeography — complete client data", () => {
  it("scores a priority-region location higher (AC2)", () => {
    const result = scoreByGeography("London", PRIORITY_REGIONS);
    assert.equal(result.matchedPriorityRegion, true);
    assert.equal(result.usedDefault, false);
  });

  it("scores a non-priority location lower than a priority one", () => {
    const priority = scoreByGeography("London", PRIORITY_REGIONS);
    const nonPriority = scoreByGeography("Bristol", PRIORITY_REGIONS);
    assert.ok(nonPriority.score < priority.score);
  });

  it("matches case-insensitively", () => {
    const result = scoreByGeography("LONDON", PRIORITY_REGIONS);
    assert.equal(result.matchedPriorityRegion, true);
  });
});

describe("scoreByGeography — missing scoring inputs (AC3)", () => {
  it("uses an explicit default for a null location", () => {
    const result = scoreByGeography(null, PRIORITY_REGIONS);
    assert.equal(result.usedDefault, true);
    assert.equal(result.matchedPriorityRegion, false);
  });

  it("uses an explicit default for an empty or whitespace location", () => {
    assert.equal(scoreByGeography("", PRIORITY_REGIONS).usedDefault, true);
    assert.equal(scoreByGeography("   ", PRIORITY_REGIONS).usedDefault, true);
  });

  it("the default is not a silent zero", () => {
    const result = scoreByGeography(undefined, PRIORITY_REGIONS);
    assert.notEqual(result.score, 0);
  });
});

describe("scoreByGeography — personal preference impact / configurable regions", () => {
  it("the same location scores differently depending on which regions are configured as priority", () => {
    const asPriority = scoreByGeography("Leeds", ["Leeds"]);
    const notPriority = scoreByGeography("Leeds", ["London"]);
    assert.equal(asPriority.matchedPriorityRegion, true);
    assert.equal(notPriority.matchedPriorityRegion, false);
    assert.ok(asPriority.score > notPriority.score);
  });

  it("an empty priority region list means nothing can match", () => {
    const result = scoreByGeography("London", []);
    assert.equal(result.matchedPriorityRegion, false);
  });
});
