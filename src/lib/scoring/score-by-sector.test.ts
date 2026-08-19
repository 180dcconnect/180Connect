import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scoreBySector } from "./score-by-sector.ts";

describe("scoreBySector — complete client data", () => {
  it("returns a score for a known sector", () => {
    const result = scoreBySector("Education");
    assert.equal(typeof result.score, "number");
    assert.equal(result.usedDefault, false);
  });

  it("scores are within the documented 0-1 range", () => {
    const result = scoreBySector("Environment");
    assert.ok(result.score >= 0 && result.score <= 1);
  });
});

describe("scoreBySector — missing scoring inputs (AC3)", () => {
  it("uses an explicit default, not an error, for a null sector", () => {
    const result = scoreBySector(null);
    assert.equal(result.usedDefault, true);
    assert.equal(typeof result.score, "number");
  });

  it("uses an explicit default for undefined", () => {
    const result = scoreBySector(undefined);
    assert.equal(result.usedDefault, true);
  });

  it("treats an empty or whitespace-only sector the same as missing", () => {
    assert.equal(scoreBySector("").usedDefault, true);
    assert.equal(scoreBySector("   ").usedDefault, true);
  });

  it("the default is not a silent zero — it's a real, documented value", () => {
    const result = scoreBySector(null);
    assert.notEqual(result.score, 0);
  });
});

describe("scoreBySector — changed input data", () => {
  it("re-evaluating with a different sector can produce a different usedDefault flag", () => {
    const withSector = scoreBySector("Health");
    const withoutSector = scoreBySector(null);
    assert.equal(withSector.usedDefault, false);
    assert.equal(withoutSector.usedDefault, true);
  });
});
