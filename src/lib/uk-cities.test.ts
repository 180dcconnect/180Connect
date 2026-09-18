import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UK_CITIES,
  POPULAR_UK_CITIES,
  searchUkCities,
  formatUkCity,
} from "./uk-cities.ts";

describe("UK_CITIES dataset", () => {
  it("contains major UK cities from England, Scotland, Wales, and Northern Ireland", () => {
    const names = new Set(UK_CITIES.map((c) => c.name));
    assert.ok(names.has("London"));
    assert.ok(names.has("Sheffield"));
    assert.ok(names.has("Edinburgh"));
    assert.ok(names.has("Cardiff"));
    assert.ok(names.has("Belfast"));
    assert.ok(names.has("Leeds"));
    assert.ok(names.has("Manchester"));
  });

  it("has no duplicate names with the same casing", () => {
    const seen = new Set<string>();
    for (const city of UK_CITIES) {
      const lower = city.name.toLowerCase();
      assert.ok(!seen.has(lower), `Duplicate city name: ${city.name}`);
      seen.add(lower);
    }
  });

  it("assigns valid regions and types to every city entry", () => {
    for (const city of UK_CITIES) {
      assert.ok(city.name.length > 0);
      assert.ok(city.region.length > 0);
      assert.ok(["city", "town", "borough", "region"].includes(city.type));
    }
  });
});

describe("searchUkCities", () => {
  it("returns popular cities when query is empty or blank", () => {
    const emptyResult = searchUkCities("");
    assert.ok(emptyResult.length > 0);
    assert.equal(emptyResult[0].name, POPULAR_UK_CITIES[0]);

    const nullResult = searchUkCities(null);
    assert.ok(nullResult.length > 0);
  });

  it("prioritizes prefix matches over substring matches", () => {
    const results = searchUkCities("Sheff");
    assert.ok(results.length > 0);
    assert.equal(results[0].name, "Sheffield");
  });

  it("finds cities by case-insensitive query", () => {
    const resultsLower = searchUkCities("manchester");
    const resultsUpper = searchUkCities("MANCHESTER");
    assert.equal(resultsLower[0].name, "Manchester");
    assert.equal(resultsUpper[0].name, "Manchester");
  });

  it("matches by region name as fallback", () => {
    const results = searchUkCities("Yorkshire");
    assert.ok(results.length > 0);
    assert.ok(results.some((c) => c.region.includes("Yorkshire")));
  });

  it("limits results to specified limit", () => {
    const results = searchUkCities("a", 4);
    assert.ok(results.length <= 4);
  });
});

describe("formatUkCity", () => {
  it("normalizes city names into Title Case", () => {
    assert.equal(formatUkCity("sheffield"), "Sheffield");
    assert.equal(formatUkCity("BURTON UPON TRENT"), "Burton Upon Trent");
    assert.equal(formatUkCity("  newcastle upon tyne  "), "Newcastle Upon Tyne");
  });
});
