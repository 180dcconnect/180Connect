import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CITY_PRESETS,
  GEOGRAPHIC_REACH_OPTIONS,
  GEOGRAPHIC_REACH_LABELS,
  INCOME_BAND_OPTIONS,
  INCOME_BAND_LABELS,
  INCOME_BAND_DESCRIPTIONS,
  deriveIncomeBand,
  MAX_CITY_LENGTH,
  MAX_CITIES,
  MAX_SECTOR_LENGTH,
  MAX_SECTORS,
  SECTOR_CATEGORY_GROUPS,
  SECTOR_PRESETS,
  SECTOR_KEYWORD_ALIASES,
} from "./constants.ts";

describe("outreach preferences constants and configuration (F195 / F196 / F197 / F198)", () => {
  it("defines standard geographic reach options and readable labels", () => {
    assert.deepEqual(GEOGRAPHIC_REACH_OPTIONS, ["local", "regional", "national", "international"]);
    assert.equal(GEOGRAPHIC_REACH_LABELS.local, "Local");
    assert.equal(GEOGRAPHIC_REACH_LABELS.regional, "Regional");
    assert.equal(GEOGRAPHIC_REACH_LABELS.national, "National");
    assert.equal(GEOGRAPHIC_REACH_LABELS.international, "International");
  });

  it("defines income band options, labels, and descriptions (F198)", () => {
    assert.deepEqual(INCOME_BAND_OPTIONS, ["under_10k", "10k_100k", "100k_1m", "over_1m"]);
    assert.equal(INCOME_BAND_LABELS.under_10k, "Under £10k");
    assert.equal(INCOME_BAND_LABELS["10k_100k"], "£10k – £100k");
    assert.equal(INCOME_BAND_LABELS["100k_1m"], "£100k – £1m");
    assert.equal(INCOME_BAND_LABELS.over_1m, "Over £1m");

    assert.ok(INCOME_BAND_DESCRIPTIONS.under_10k.includes("< £10k"));
    assert.ok(INCOME_BAND_DESCRIPTIONS["100k_1m"].includes("£100k – £1m"));
  });

  it("correctly derives income bands from numeric total income (F198)", () => {
    assert.equal(deriveIncomeBand(0), "under_10k");
    assert.equal(deriveIncomeBand(9_999), "under_10k");
    assert.equal(deriveIncomeBand(10_000), "10k_100k");
    assert.equal(deriveIncomeBand(50_000), "10k_100k");
    assert.equal(deriveIncomeBand(100_000), "10k_100k");
    assert.equal(deriveIncomeBand(100_001), "100k_1m");
    assert.equal(deriveIncomeBand(750_000), "100k_1m");
    assert.equal(deriveIncomeBand(1_000_000), "100k_1m");
    assert.equal(deriveIncomeBand(1_000_001), "over_1m");
    assert.equal(deriveIncomeBand(5_000_000), "over_1m");

    assert.equal(deriveIncomeBand(null), null);
    assert.equal(deriveIncomeBand(undefined), null);
    assert.equal(deriveIncomeBand(Number.NaN), null);
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

  it("defines standard sector keyword aliases for cross-source matching (F197)", () => {
    assert.ok(SECTOR_KEYWORD_ALIASES.health.includes("healthcare"));
    assert.ok(SECTOR_KEYWORD_ALIASES.education.includes("school"));
    assert.ok(SECTOR_KEYWORD_ALIASES.environment.includes("sustainability"));
    assert.ok(SECTOR_KEYWORD_ALIASES.poverty.includes("relief"));
  });
});
