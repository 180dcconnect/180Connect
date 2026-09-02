import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCityWithRegion, PIPELINE_STATUSES } from "./organisation-format.ts";

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
