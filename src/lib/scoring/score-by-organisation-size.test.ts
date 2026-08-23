import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scoreByOrganisationSize } from "./score-by-organisation-size.ts";

describe("scoreByOrganisationSize — complete client data", () => {
  it("classifies an income under £10k as under_10k", () => {
    const result = scoreByOrganisationSize(5_000);
    assert.equal(result.band, "under_10k");
    assert.equal(result.usedDefault, false);
  });

  it("classifies a £10k–£100k income as 10k_100k", () => {
    const result = scoreByOrganisationSize(50_000);
    assert.equal(result.band, "10k_100k");
  });

  it("classifies a £100k–£1m income as 100k_1m", () => {
    const result = scoreByOrganisationSize(500_000);
    assert.equal(result.band, "100k_1m");
  });

  it("classifies an income over £1m as over_1m", () => {
    const result = scoreByOrganisationSize(5_000_000);
    assert.equal(result.band, "over_1m");
  });

  it("larger bands score higher than smaller ones", () => {
    const under10k = scoreByOrganisationSize(5_000);
    const tenToHundred = scoreByOrganisationSize(50_000);
    const hundredToMillion = scoreByOrganisationSize(500_000);
    const overMillion = scoreByOrganisationSize(5_000_000);
    assert.ok(under10k.score < tenToHundred.score);
    assert.ok(tenToHundred.score < hundredToMillion.score);
    assert.ok(hundredToMillion.score < overMillion.score);
  });
});

describe("scoreByOrganisationSize — missing scoring inputs (AC2)", () => {
  it("uses an explicit default rather than excluding the client (null)", () => {
    const result = scoreByOrganisationSize(null);
    assert.equal(result.usedDefault, true);
    assert.equal(result.band, null);
    assert.equal(typeof result.score, "number");
  });

  it("uses an explicit default for undefined", () => {
    const result = scoreByOrganisationSize(undefined);
    assert.equal(result.usedDefault, true);
  });

  it("treats NaN the same as missing", () => {
    const result = scoreByOrganisationSize(NaN);
    assert.equal(result.usedDefault, true);
  });

  it("treats a negative income as invalid, not a valid band", () => {
    const result = scoreByOrganisationSize(-500);
    assert.equal(result.usedDefault, true);
    assert.equal(result.band, null);
  });

  it("the default is not a silent zero", () => {
    const result = scoreByOrganisationSize(null);
    assert.notEqual(result.score, 0);
  });
});

describe("scoreByOrganisationSize — boundary values", () => {
  // Boundaries mirror deriveIncomeBand's pinned semantics (lower bound
  // exclusive, upper bound inclusive), matching preferences.test.ts.
  it("£9,999 stays in under_10k", () => {
    const result = scoreByOrganisationSize(9_999);
    assert.equal(result.band, "under_10k");
  });

  it("an income exactly at £10k starts the 10k_100k band", () => {
    const result = scoreByOrganisationSize(10_000);
    assert.equal(result.band, "10k_100k");
  });

  it("an income exactly at £100k stays in the 10k_100k band", () => {
    const result = scoreByOrganisationSize(100_000);
    assert.equal(result.band, "10k_100k");
  });

  it("an income of £100,001 starts the 100k_1m band", () => {
    const result = scoreByOrganisationSize(100_001);
    assert.equal(result.band, "100k_1m");
  });

  it("an income exactly at £1m stays in the 100k_1m band", () => {
    const result = scoreByOrganisationSize(1_000_000);
    assert.equal(result.band, "100k_1m");
  });

  it("an income of £1,000,001 counts as over_1m", () => {
    const result = scoreByOrganisationSize(1_000_001);
    assert.equal(result.band, "over_1m");
  });

  it("zero income is valid data, not missing data", () => {
    const result = scoreByOrganisationSize(0);
    assert.equal(result.usedDefault, false);
    assert.equal(result.band, "under_10k");
  });
});
