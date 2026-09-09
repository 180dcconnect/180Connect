import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CITY_REGION_PRESETS,
  formatPostcodeAreaLabel,
  resolveLocationInput,
} from "./city-postcodes.ts";

describe("CITY_REGION_PRESETS", () => {
  it("includes Manchester and Greater Manchester presets", () => {
    const manchester = CITY_REGION_PRESETS.find((p) => p.id === "manchester");
    assert.ok(manchester);
    assert.deepEqual(manchester.postcodeAreas, ["M"]);

    const gm = CITY_REGION_PRESETS.find((p) => p.id === "greater-manchester");
    assert.ok(gm);
    assert.ok(gm.postcodeAreas.includes("M"));
    assert.ok(gm.postcodeAreas.includes("BL"));
  });

  it("includes Sheffield and South Yorkshire presets", () => {
    const sheffield = CITY_REGION_PRESETS.find((p) => p.id === "sheffield");
    assert.ok(sheffield);
    assert.deepEqual(sheffield.postcodeAreas, ["S"]);

    const sy = CITY_REGION_PRESETS.find((p) => p.id === "south-yorkshire");
    assert.ok(sy);
    assert.ok(sy.postcodeAreas.includes("S"));
    assert.ok(sy.postcodeAreas.includes("DN"));
  });
});

describe("resolveLocationInput", () => {
  it("resolves Manchester by name to ['M']", () => {
    assert.deepEqual(resolveLocationInput("Manchester"), ["M"]);
    assert.deepEqual(resolveLocationInput("manchester"), ["M"]);
  });

  it("resolves Greater Manchester to multiple postcode areas", () => {
    const result = resolveLocationInput("Greater Manchester");
    assert.ok(result.includes("M"));
    assert.ok(result.includes("SK"));
    assert.ok(result.includes("OL"));
  });

  it("resolves Sheffield to ['S']", () => {
    assert.deepEqual(resolveLocationInput("Sheffield"), ["S"]);
    assert.deepEqual(resolveLocationInput("sheffield"), ["S"]);
  });

  it("resolves Leeds to ['LS']", () => {
    assert.deepEqual(resolveLocationInput("Leeds"), ["LS"]);
  });

  it("resolves raw postcode area 'M' or 'LS'", () => {
    assert.deepEqual(resolveLocationInput("M"), ["M"]);
    assert.deepEqual(resolveLocationInput("LS"), ["LS"]);
    assert.deepEqual(resolveLocationInput("s"), ["S"]);
  });

  it("resolves full postcodes to area", () => {
    assert.deepEqual(resolveLocationInput("M1 1AA"), ["M"]);
    assert.deepEqual(resolveLocationInput("S1 2HE"), ["S"]);
    assert.deepEqual(resolveLocationInput("LS2 9JT"), ["LS"]);
  });

  it("returns empty array for unrecognized or blank text", () => {
    assert.deepEqual(resolveLocationInput(""), []);
    assert.deepEqual(resolveLocationInput("   "), []);
    assert.deepEqual(resolveLocationInput("xyz123nonexistent"), []);
  });
});

describe("formatPostcodeAreaLabel", () => {
  it("formats prominent areas with city names", () => {
    assert.equal(formatPostcodeAreaLabel("M"), "M (Manchester)");
    assert.equal(formatPostcodeAreaLabel("S"), "S (Sheffield)");
    assert.equal(formatPostcodeAreaLabel("LS"), "LS (Leeds)");
    assert.equal(formatPostcodeAreaLabel("B"), "B (Birmingham)");
  });

  it("falls back to uppercase code for unmapped areas", () => {
    assert.equal(formatPostcodeAreaLabel("ZE"), "ZE");
  });
});
