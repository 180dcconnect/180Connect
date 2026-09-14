import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SCORING_RULES,
  MAX_PRIORITY_TOWNS,
  normaliseTownList,
  sanitizeScoringRules,
  SECTOR_CATEGORIES,
  SECTOR_RANK_LADDER,
  sectorRankingFrom,
  sectorScoresFromRanking,
  townsForCriteria,
} from "./scout-config.ts";

describe("scout config — defaults", () => {
  it("defaults to today's constants, with the priority towns title-cased", () => {
    assert.equal(DEFAULT_SCORING_RULES.sectorScores["Health & Wellbeing"], 0.7);
    assert.deepEqual(DEFAULT_SCORING_RULES.geography.priorityTowns, [
      "Sheffield",
      "Rotherham",
      "Barnsley",
      "Doncaster",
    ]);
    assert.equal(DEFAULT_SCORING_RULES.geography.insideScore, 0.8);
    assert.equal(DEFAULT_SCORING_RULES.sizeScores.over_1m, 0.9);
  });

  it("lists sectors in their default ranking order", () => {
    assert.equal(SECTOR_CATEGORIES[0], "Health & Wellbeing");
    assert.equal(SECTOR_CATEGORIES.at(-1), "Arts, Culture & Heritage");
  });
});

describe("scout config — sanitizing a stored config", () => {
  it("yields the defaults for a weights-only config saved before this change", () => {
    assert.deepEqual(sanitizeScoringRules({ weights: { sector: 0.2 } }), DEFAULT_SCORING_RULES);
  });

  it("keeps valid stored values and falls back per bad value", () => {
    const rules = sanitizeScoringRules({
      sectorScores: { "Education & Youth": 0.9, "Health & Wellbeing": "high" },
      geography: { priorityTowns: ["Leeds", " leeds ", ""], insideScore: 2, outsideScore: 0.1 },
      sizeScores: { under_10k: 0.7 },
    });
    assert.equal(rules.sectorScores["Education & Youth"], 0.9);
    assert.equal(rules.sectorScores["Health & Wellbeing"], 0.7);
    assert.deepEqual(rules.geography.priorityTowns, ["Leeds"]);
    assert.equal(rules.geography.insideScore, 1);
    assert.equal(rules.geography.outsideScore, 0.1);
    assert.equal(rules.sizeScores.under_10k, 0.7);
    assert.equal(rules.sizeScores.over_1m, 0.9);
  });

  it("respects an explicitly empty town list", () => {
    assert.deepEqual(sanitizeScoringRules({ geography: { priorityTowns: [] } }).geography.priorityTowns, []);
  });
});

describe("scout config — sector ranking", () => {
  it("gives the ladder's scores in the admin's order", () => {
    const order = [...SECTOR_CATEGORIES].reverse();
    const scores = sectorScoresFromRanking(order);
    assert.equal(scores["Arts, Culture & Heritage"], SECTOR_RANK_LADDER[0]);
    assert.equal(scores["Health & Wellbeing"], SECTOR_RANK_LADDER.at(-1));
  });

  it("never hands out the 0.5 neutral and keeps every score distinct", () => {
    const scores = Object.values(sectorScoresFromRanking(SECTOR_CATEGORIES));
    assert.equal(new Set(scores).size, scores.length);
    assert.ok(!scores.includes(0.5));
  });

  it("round-trips a ranking through scores", () => {
    const order = [SECTOR_CATEGORIES[3], ...SECTOR_CATEGORIES.filter((_, i) => i !== 3)];
    assert.deepEqual(sectorRankingFrom(sectorScoresFromRanking(order)), order);
  });
});

describe("scout config — towns", () => {
  it("tidies spacing, drops blanks and duplicates, keeps order", () => {
    assert.deepEqual(normaliseTownList(["  Leeds ", "York", "leeds", "", 7, "New   Mills"]), [
      "Leeds",
      "York",
      "New Mills",
    ]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_PRIORITY_TOWNS + 5 }, (_, i) => `Town ${i}`);
    assert.equal(normaliseTownList(many).length, MAX_PRIORITY_TOWNS);
  });

  it("lowercases towns for the client criteria check", () => {
    assert.deepEqual(townsForCriteria(DEFAULT_SCORING_RULES), [
      "sheffield",
      "rotherham",
      "barnsley",
      "doncaster",
    ]);
  });
});
