import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CITY_PRESETS,
  GEOGRAPHIC_REACH_OPTIONS,
  GEOGRAPHIC_REACH_LABELS,
  INCOME_BAND_OPTIONS,
  INCOME_BAND_LABELS,
  MAX_CITY_LENGTH,
  MAX_CITIES,
  MAX_SECTOR_LENGTH,
  MAX_SECTORS,
  SECTOR_CATEGORY_GROUPS,
  SECTOR_PRESETS,
} from "./constants.ts";
import { CANONICAL_SECTOR_GROUPS } from "../../clients/visible-clients.ts";

describe("outreach preferences constants and configuration (F195 / F196)", () => {
  it("defines standard geographic reach options and readable labels", () => {
    assert.deepEqual(GEOGRAPHIC_REACH_OPTIONS, ["local", "regional", "national", "international"]);
    assert.equal(GEOGRAPHIC_REACH_LABELS.local, "Local");
    assert.equal(GEOGRAPHIC_REACH_LABELS.regional, "Regional");
    assert.equal(GEOGRAPHIC_REACH_LABELS.national, "National");
    assert.equal(GEOGRAPHIC_REACH_LABELS.international, "International");
  });

  it("defines income band options and labels", () => {
    assert.deepEqual(INCOME_BAND_OPTIONS, ["under_10k", "10k_100k", "100k_1m", "over_1m"]);
    assert.equal(INCOME_BAND_LABELS.under_10k, "Under £10k");
  });

  it("includes Sheffield and South Yorkshire in the city presets for F196 granularity", () => {
    assert.ok(CITY_PRESETS.includes("Sheffield"));
    assert.ok(CITY_PRESETS.includes("South Yorkshire"));
    assert.ok(CITY_PRESETS.includes("Rotherham"));
    assert.ok(CITY_PRESETS.includes("Barnsley"));
    assert.ok(CITY_PRESETS.includes("Doncaster"));
    assert.ok(CITY_PRESETS.includes("Leeds"));
  });

  it("enforces sensible max caps for custom cities and sectors", () => {
    assert.equal(MAX_CITY_LENGTH, 60);
    assert.equal(MAX_CITIES, 20);
    assert.equal(MAX_SECTOR_LENGTH, 60);
    assert.equal(MAX_SECTORS, 20);
  });

  it("includes comprehensive sector taxonomy covering Charity Commission & Companies House sectors (F197)", () => {
    assert.ok(SECTOR_PRESETS.includes("Health & Social Care"));
    assert.ok(SECTOR_PRESETS.includes("Mental Health"));
    assert.ok(SECTOR_PRESETS.includes("Education & Training"));
    assert.ok(SECTOR_PRESETS.includes("Environment & Conservation"));
    assert.ok(SECTOR_PRESETS.includes("Poverty Relief"));
    assert.ok(SECTOR_PRESETS.includes("Community Development"));
    assert.ok(SECTOR_PRESETS.includes("Arts & Culture"));
    assert.ok(SECTOR_PRESETS.includes("Social Enterprise"));

    assert.equal(SECTOR_CATEGORY_GROUPS.length, 6);
    assert.ok(SECTOR_CATEGORY_GROUPS.some((g) => g.category === "Health & Wellbeing"));
    assert.ok(SECTOR_CATEGORY_GROUPS.some((g) => g.category === "Education & Youth"));
    assert.ok(SECTOR_CATEGORY_GROUPS.some((g) => g.category === "Environment & Sustainability"));
    assert.ok(SECTOR_CATEGORY_GROUPS.some((g) => g.category === "Poverty & Community"));
  });

  it("defines canonical sector groups for cross-source queue matching (F197)", () => {
    // Single source of truth lives with the matcher in visible-clients.ts;
    // these assertions pin the aliases the presets rely on.
    assert.ok(CANONICAL_SECTOR_GROUPS.health.includes("healthcare"));
    assert.ok(CANONICAL_SECTOR_GROUPS.education.includes("school"));
    assert.ok(CANONICAL_SECTOR_GROUPS.environment.includes("sustainability"));
    assert.ok(CANONICAL_SECTOR_GROUPS.poverty.includes("homeless"));
  });
});
