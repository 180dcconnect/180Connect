import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { looksLikeNaturalLanguage, normaliseQuery } from "./nl-query-shape.ts";

describe("looksLikeNaturalLanguage", () => {
  it("treats a charity name as a name, and never pays to interpret it", () => {
    // Every one of these is a real-shaped legal name. A false positive here is
    // the whole cost story of this feature going wrong quietly.
    for (const name of [
      "Oxfam",
      "Leeds Community Foundation",
      "Barnsley Youth Trust",
      "The Sailors' Society",
      "Save the Children Fund",
    ]) {
      assert.equal(looksLikeNaturalLanguage(name), false, name);
    }
  });

  it("recognises a described search", () => {
    for (const query of [
      "small education charities in Leeds",
      "charities with no response yet",
      "who has the highest priority score",
      "environment charities under £100k",
      "show me converted clients",
    ]) {
      assert.equal(looksLikeNaturalLanguage(query), true, query);
    }
  });

  it("interprets a long phrase even with no marker word", () => {
    assert.equal(
      looksLikeNaturalLanguage("education literacy schools reading children books"),
      true,
    );
  });

  it("never interprets a one- or two-word query", () => {
    assert.equal(looksLikeNaturalLanguage("Leeds"), false);
    assert.equal(looksLikeNaturalLanguage("small charities"), false);
    assert.equal(looksLikeNaturalLanguage(""), false);
    assert.equal(looksLikeNaturalLanguage(null), false);
    assert.equal(looksLikeNaturalLanguage(undefined), false);
  });
});

describe("normaliseQuery", () => {
  it("collapses case and spacing so one interpretation serves every spelling of it", () => {
    assert.equal(
      normaliseQuery("  Small   Education Charities In LEEDS "),
      "small education charities in leeds",
    );
  });
});
