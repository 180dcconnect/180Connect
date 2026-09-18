import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  lettersInOrderPattern,
  normaliseName,
  parseRegisterSearch,
  searchWords,
} from "./register-search-term.ts";

describe("parseRegisterSearch — numbers", () => {
  it("reads 6 or 7 digits as a charity number and a padded company number", () => {
    const parsed = parseRegisterSearch("1012345");
    assert.equal(parsed.kind, "number");
    if (parsed.kind !== "number") return;
    assert.equal(parsed.charityNumber, 1012345);
    assert.equal(parsed.companyNumber, "01012345");
  });

  it("reads 8 digits and prefixed numbers as company numbers only", () => {
    const eight = parseRegisterSearch("01234567");
    assert.deepEqual(
      eight.kind === "number" && [eight.charityNumber, eight.companyNumber],
      [null, "01234567"],
    );
    const scottish = parseRegisterSearch("sc 123456");
    assert.equal(scottish.kind === "number" && scottish.companyNumber, "SC123456");
  });
});

describe("parseRegisterSearch — places", () => {
  it("reads a postcode or outward code on its own as a postcode", () => {
    const full = parseRegisterSearch("s1 2he");
    assert.equal(full.kind === "text" && full.postcode, "S1 2HE");
    const outward = parseRegisterSearch("S1");
    assert.equal(outward.kind === "text" && outward.postcode, "S1");
  });

  it("splits a trailing postcode off a name", () => {
    const parsed = parseRegisterSearch("Community Trust S1 2HE");
    assert.equal(parsed.kind, "text");
    if (parsed.kind !== "text") return;
    assert.equal(parsed.name, "Community Trust");
    assert.equal(parsed.postcode, "S1 2HE");
  });

  it("splits a trailing UK town off a name, and drops a dangling connector", () => {
    const parsed = parseRegisterSearch("Community Trust in Sheffield");
    assert.equal(parsed.kind, "text");
    if (parsed.kind !== "text") return;
    assert.equal(parsed.name, "Community Trust");
    assert.equal(parsed.town, "Sheffield");
  });

  it("leaves a plain name alone", () => {
    const parsed = parseRegisterSearch("Age Concern");
    assert.deepEqual(
      parsed.kind === "text" && [parsed.name, parsed.postcode, parsed.town],
      ["Age Concern", null, null],
    );
  });

  it("needs two characters", () => {
    assert.equal(parseRegisterSearch(" a ").kind, "empty");
  });
});

describe("name normalising", () => {
  it("agrees on apostrophes and full stops", () => {
    assert.equal(normaliseName("St. Mary's & All Saints"), "st marys all saints");
  });

  it("drops stopwords and single letters from the words searched", () => {
    assert.deepEqual(searchWords("The Sheffield Trust Ltd"), ["sheffield", "trust"]);
    assert.deepEqual(searchWords("Arts and Crafts"), ["arts", "crafts"]);
    assert.deepEqual(searchWords("a_b"), []);
  });

  it("builds a letters-in-order prefilter for a word", () => {
    assert.equal(lettersInOrderPattern("marys"), "%m%a%r%y%s%");
  });
});
