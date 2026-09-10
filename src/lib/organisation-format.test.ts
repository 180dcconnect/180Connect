import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatCityWithRegion,
  formatCountryName,
  formatGeographicReach,
  PIPELINE_STATUSES,
} from "./organisation-format.ts";

describe("PIPELINE_STATUSES", () => {
  it("has exactly the ten F146-F155 values, not_contacted first", () => {
    assert.deepEqual(PIPELINE_STATUSES, [
      "not_contacted",
      "initial_outreach_sent",
      "follow_up_sent",
      "responded",
      "converted",
      "future_potential",
      "soft_no",
      "hard_no",
      "no_response",
      "loss_due_timing",
    ]);
  });
});

describe("formatCityWithRegion", () => {
  it("formats recognized UK cities with their region", () => {
    assert.equal(formatCityWithRegion("Sheffield"), "Sheffield, South Yorkshire");
    assert.equal(formatCityWithRegion("Manchester"), "Manchester, Greater Manchester");
    assert.equal(formatCityWithRegion("Leeds"), "Leeds, West Yorkshire");
    assert.equal(formatCityWithRegion("Birmingham"), "Birmingham, West Midlands");
    assert.equal(formatCityWithRegion("Newcastle"), "Newcastle, Tyne and Wear");
    assert.equal(formatCityWithRegion("Barnsley"), "Barnsley, South Yorkshire");
  });

  it("handles case-insensitivity and surrounding whitespace", () => {
    assert.equal(formatCityWithRegion("  sheffield  "), "sheffield, South Yorkshire");
    assert.equal(formatCityWithRegion("MANCHESTER"), "MANCHESTER, Greater Manchester");
  });

  it("does not duplicate region when city equals region name", () => {
    assert.equal(formatCityWithRegion("Bristol"), "Bristol");
  });

  it("does not modify strings that already include a comma / region", () => {
    assert.equal(
      formatCityWithRegion("Sheffield, South Yorkshire"),
      "Sheffield, South Yorkshire",
    );
  });

  it("returns unrecognised or international cities unchanged", () => {
    assert.equal(formatCityWithRegion("Dublin"), "Dublin");
    assert.equal(formatCityWithRegion("Valencia"), "Valencia");
    assert.equal(formatCityWithRegion("Some Small Town"), "Some Small Town");
  });

  it("returns an empty string for blank input", () => {
    assert.equal(formatCityWithRegion(""), "");
    assert.equal(formatCityWithRegion("   "), "");
  });
});

describe("formatGeographicReach", () => {
  it("formats valid reach values into title-case", () => {
    assert.equal(formatGeographicReach("local"), "Local");
    assert.equal(formatGeographicReach("regional"), "Regional");
    assert.equal(formatGeographicReach("national"), "National");
    assert.equal(formatGeographicReach("international"), "International");
  });

  it("handles whitespace and case insensitivity", () => {
    assert.equal(formatGeographicReach("  regional  "), "Regional");
    assert.equal(formatGeographicReach("NATIONAL"), "National");
  });

  it("returns empty string for null or undefined", () => {
    assert.equal(formatGeographicReach(null), "");
    assert.equal(formatGeographicReach(undefined), "");
  });
});

describe("formatCountryName", () => {
  it("formats GB and UK with display names", () => {
    assert.equal(formatCountryName("GB"), "United Kingdom (GB)");
    assert.equal(formatCountryName("UK"), "United Kingdom (GB)");
  });

  it("formats ISO codes for foreign countries", () => {
    assert.equal(formatCountryName("US"), "United States (US)");
    assert.equal(formatCountryName("IT"), "Italy (IT)");
  });

  it("returns empty string for null or undefined", () => {
    assert.equal(formatCountryName(null), "");
    assert.equal(formatCountryName(undefined), "");
  });
});

