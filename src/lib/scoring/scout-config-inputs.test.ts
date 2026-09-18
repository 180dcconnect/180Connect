import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_WEIGHTS } from "./calculate-priority-score.ts";
import { DEFAULT_SCORING_RULES, SECTOR_CATEGORIES } from "./scout-config.ts";
import {
  configInputsEqual,
  inputFromStored,
  rpcPayloadFromInput,
  validateScoutConfigInput,
} from "./scout-config-inputs.ts";

const base = () => inputFromStored(DEFAULT_WEIGHTS, DEFAULT_SCORING_RULES);

describe("scout config inputs — conversion", () => {
  it("shows stored fractions as percentages and a ranking", () => {
    const input = base();
    assert.equal(input.weights.sector, 20);
    assert.equal(input.geography.inside, 80);
    assert.equal(input.sizeScores.under_10k, 20);
    assert.deepEqual(input.sectorOrder, SECTOR_CATEGORIES);
  });

  it("round-trips the defaults to the same payload the engine defaults to", () => {
    const payload = rpcPayloadFromInput(base());
    assert.deepEqual(payload.sectorScores, DEFAULT_SCORING_RULES.sectorScores);
    assert.equal(payload.geography.insideScore, 0.8);
    assert.equal(payload.sizeScores.over_100m, 0.4);
    assert.deepEqual(payload.geography.priorityTowns, DEFAULT_SCORING_RULES.geography.priorityTowns);
  });

  it("scores a re-ranked sector list from the top of the ladder", () => {
    const input = { ...base(), sectorOrder: [...SECTOR_CATEGORIES].reverse() };
    assert.equal(rpcPayloadFromInput(input).sectorScores["Arts, Culture & Heritage"], 0.7);
  });
});

describe("scout config inputs — validation", () => {
  it("accepts the defaults", () => {
    assert.equal(validateScoutConfigInput(base()).success, true);
  });

  it("refuses a ranking that drops or repeats a sector", () => {
    const input = { ...base(), sectorOrder: [SECTOR_CATEGORIES[0], SECTOR_CATEGORIES[0]] };
    assert.equal(validateScoutConfigInput(input).success, false);
  });

  it("refuses every weight at zero", () => {
    const input = {
      ...base(),
      weights: { sector: 0, geography: 0, size: 0, partnershipHistory: 0, previousContact: 0 },
    };
    const result = validateScoutConfigInput(input);
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /zero/);
  });

  it("refuses weights that do not add up to 100%", () => {
    const input = {
      ...base(),
      weights: { sector: 30, geography: 30, size: 30, partnershipHistory: 30, previousContact: 30 },
    };
    const result = validateScoutConfigInput(input);
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /100%/);
  });

  it("refuses a score above 100", () => {
    const input = { ...base(), geography: { inside: 120, outside: 30 } };
    assert.equal(validateScoutConfigInput(input).success, false);
  });

  it("tidies the town list", () => {
    const result = validateScoutConfigInput({ ...base(), priorityTowns: [" Leeds", "leeds", ""] });
    assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.data.priorityTowns, ["Leeds"]);
  });
});

describe("scout config inputs — change detection", () => {
  it("treats town case and spacing as no change", () => {
    const a = base();
    const b = { ...a, priorityTowns: a.priorityTowns.map((town) => ` ${town.toUpperCase()} `) };
    assert.equal(configInputsEqual(a, b), true);
  });

  it("notices a moved sector, a town, or a band score", () => {
    const a = base();
    assert.equal(configInputsEqual(a, { ...a, sectorOrder: [...a.sectorOrder].reverse() }), false);
    assert.equal(configInputsEqual(a, { ...a, priorityTowns: [...a.priorityTowns, "Leeds"] }), false);
    assert.equal(
      configInputsEqual(a, { ...a, sizeScores: { ...a.sizeScores, over_100m: 50 } }),
      false,
    );
  });
});
