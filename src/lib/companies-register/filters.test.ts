import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeFilters,
  isUnfiltered,
  normalisePostcodeArea,
  parseFilters,
} from "./filters.ts";

describe("parseFilters", () => {
  it("defaults to live companies with nothing else narrowed", () => {
    const parsed = parseFilters({});
    assert.deepEqual(parsed.statuses, ["active"]);
    assert.ok(isUnfiltered(parsed));
  });

  it("keeps an explicit empty status list as everything", () => {
    const parsed = parseFilters({ statuses: [] });
    assert.deepEqual(parsed.statuses, []);
    assert.ok(!isUnfiltered(parsed));
  });

  it("cleans SIC codes to 5 digits and drops garbage", () => {
    const parsed = parseFilters({ sicCodes: ["86101 - Hospital", "88990", "4521", "abc", ""] });
    assert.deepEqual(parsed.sicCodes, ["86101", "88990"]);
  });

  it("swaps inverted incorporation bounds", () => {
    const parsed = parseFilters({ incorporatedFrom: "2024-01-01", incorporatedTo: "2020-01-01" });
    assert.equal(parsed.incorporatedFrom, "2020-01-01");
    assert.equal(parsed.incorporatedTo, "2024-01-01");
  });

  it("splits a comma-joined name search into tokens", () => {
    const parsed = parseFilters({ nameContains: "hospice, shelter" });
    assert.deepEqual(parsed.names, ["hospice", "shelter"]);
  });

  it("never throws on garbage input", () => {
    assert.doesNotThrow(() => parseFilters(null));
    assert.doesNotThrow(() => parseFilters("hospice"));
    assert.doesNotThrow(() => parseFilters({ sicCodes: "86101" }));
  });
});

describe("normalisePostcodeArea", () => {
  it("never lets a longer area collapse into a shorter one", () => {
    assert.equal(normalisePostcodeArea("S1 2HE"), "S");
    assert.equal(normalisePostcodeArea("SA1 1AA"), "SA");
    assert.notEqual(normalisePostcodeArea("SA1 1AA"), "S");
  });
});

describe("describeFilters", () => {
  it("states the live default plainly", () => {
    assert.equal(describeFilters({}), "Every live company in the staged register.");
  });

  it("reads back a CIC + SIC + postcode selection", () => {
    const sentence = describeFilters({
      cicOnly: true,
      sicCodes: ["86101", "88910"],
      postcodeAreas: ["S"],
      statuses: ["active"],
    });
    assert.match(sentence, /Community interest companies only/);
    assert.match(sentence, /SIC 2 codes/);
    assert.match(sentence, /S postcodes/);
  });

  it("names a widened status selection", () => {
    assert.match(describeFilters({ statuses: [] }), /Including non-live companies/);
    assert.match(
      describeFilters({ statuses: ["active", "liquidation"] }),
      /With status active or liquidation/,
    );
  });
});
