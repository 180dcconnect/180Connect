import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scoreBySector } from "./score-by-sector.ts";

const CATEGORY_SECTORS = [
  { sector: "Mental Health", category: "Health & Wellbeing" },
  { sector: "Education & Training", category: "Education & Youth" },
  { sector: "Housing & Homelessness", category: "Poverty & Community" },
  { sector: "Social Enterprise", category: "Social Justice & Enterprise" },
  { sector: "Climate & Sustainability", category: "Environment & Sustainability" },
  { sector: "Arts & Culture", category: "Arts, Culture & Heritage" },
] as const;

describe("scoreBySector — complete client data (AC1)", () => {
  it("returns a defined score for each taxonomy category, flagged as matched", () => {
    for (const { sector, category } of CATEGORY_SECTORS) {
      const result = scoreBySector(sector);
      assert.equal(result.matchedTaxonomy, true, sector);
      assert.equal(result.matchedCategory, category, sector);
      assert.equal(typeof result.score, "number");
      assert.equal(result.usedDefault, false);
    }
  });

  it("each category has its own score — sector choice changes the result", () => {
    const scores = new Set(
      CATEGORY_SECTORS.map(({ sector }) => scoreBySector(sector).score),
    );
    assert.equal(scores.size, CATEGORY_SECTORS.length);
  });

  it("scores are within the documented 0-1 range", () => {
    for (const { sector } of CATEGORY_SECTORS) {
      const { score } = scoreBySector(sector);
      assert.ok(score >= 0 && score <= 1, sector);
    }
  });

  it("matching is case- and whitespace-insensitive on presets and categories", () => {
    const preset = scoreBySector("  mental health  ");
    assert.equal(preset.matchedCategory, "Health & Wellbeing");

    const category = scoreBySector("education & youth");
    assert.equal(category.matchedCategory, "Education & Youth");
    assert.equal(
      category.score,
      scoreBySector("Education & Training").score,
    );
  });

  it("free text mentioning a preset still matches its category", () => {
    const result = scoreBySector("Youth mental health charity");
    assert.equal(result.matchedTaxonomy, true);
    assert.equal(result.matchedCategory, "Health & Wellbeing");
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

  it("the default is neutral and distinct from every recorded-sector score", () => {
    const defaultScore = scoreBySector(null).score;
    for (const { sector } of CATEGORY_SECTORS) {
      assert.notEqual(scoreBySector(sector).score, defaultScore, sector);
    }
  });
});

describe("scoreBySector — changed input data recalculates", () => {
  it("a different category produces a different score (Education vs Health)", () => {
    const education = scoreBySector("Education & Training");
    const health = scoreBySector("Mental Health");
    assert.equal(education.usedDefault, false);
    assert.equal(health.usedDefault, false);
    assert.notEqual(education.score, health.score);
  });

  it("removing a recorded sector moves the score away from its category value", () => {
    const withSector = scoreBySector("Medical Research");
    const withoutSector = scoreBySector(null);
    assert.notEqual(withSector.score, withoutSector.score);
    assert.equal(withoutSector.usedDefault, true);
  });

  it("swapping within the same category keeps the same component value", () => {
    const before = scoreBySector("Mental Health");
    const after = scoreBySector("Disability Support");
    assert.equal(before.score, after.score);
    assert.deepEqual(before.matchedCategory, after.matchedCategory);
  });

  it("replacing unclassifiable free text with a known sector recalculates", () => {
    const unknown = scoreBySector("Completely unrelated free text");
    assert.equal(unknown.usedDefault, false);
    assert.equal(unknown.matchedTaxonomy, false);

    const known = scoreBySector("Poverty Relief");
    assert.equal(known.matchedTaxonomy, true);
    assert.notEqual(unknown.score, known.score);
  });
});
