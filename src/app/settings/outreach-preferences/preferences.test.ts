import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CITY_PRESETS,
  DEFAULT_FIRST_FOLLOW_UP_DAYS,
  DEFAULT_SECOND_FOLLOW_UP_DAYS,
  GEOGRAPHIC_REACH_OPTIONS,
  GEOGRAPHIC_REACH_LABELS,
  GRANT_PREFERENCE_LABELS,
  GRANT_PREFERENCE_DESCRIPTIONS,
  INCOME_BAND_OPTIONS,
  INCOME_BAND_LABELS,
  INCOME_BAND_DESCRIPTIONS,
  MAX_FIRST_FOLLOW_UP_DAYS,
  MAX_SECOND_FOLLOW_UP_DAYS,
  MIN_FOLLOW_UP_DAYS,
  clampFollowUpDays,
  validateFollowUpOrdering,
  deriveIncomeBand,
  MAX_CITY_LENGTH,
  MAX_CITIES,
  MAX_SECTOR_LENGTH,
  MAX_SECTORS,
  SECTOR_CATEGORY_GROUPS,
  SECTOR_PRESETS,
} from "./constants.ts";
import { CANONICAL_SECTOR_GROUPS } from "../../clients/visible-clients.ts";

describe("outreach preferences constants and configuration (F195 / F196 / F197 / F198 / F199 / F202)", () => {
  it("defines standard follow-up timing thresholds and clamping (F202)", () => {
    assert.equal(DEFAULT_FIRST_FOLLOW_UP_DAYS, 7);
    assert.equal(DEFAULT_SECOND_FOLLOW_UP_DAYS, 14);
    assert.equal(MIN_FOLLOW_UP_DAYS, 1);
    assert.equal(MAX_FIRST_FOLLOW_UP_DAYS, 60);
    assert.equal(MAX_SECOND_FOLLOW_UP_DAYS, 90);

    assert.equal(clampFollowUpDays(5, 7, 1, 60), 5);
    assert.equal(clampFollowUpDays(0, 7, 1, 60), 1);
    assert.equal(clampFollowUpDays(100, 7, 1, 60), 60);
    assert.equal(clampFollowUpDays("12", 7, 1, 60), 12);
    assert.equal(clampFollowUpDays("invalid", 7, 1, 60), 7);
    assert.equal(clampFollowUpDays(null, 7, 1, 60), 7);
  });

  it("rejects a second follow-up that fires before the first (F202 review)", () => {
    assert.equal(validateFollowUpOrdering(7, 14), null);
    assert.equal(validateFollowUpOrdering(5, 10), null);
    assert.ok(validateFollowUpOrdering(20, 10));
    assert.ok(validateFollowUpOrdering(10, 10));
  });

  it("defines standard grant preference labels and descriptions (F199)", () => {
    assert.ok(GRANT_PREFERENCE_LABELS.prioritise_grant_recipients.includes("360Giving"));
    assert.ok(GRANT_PREFERENCE_DESCRIPTIONS.prioritise_grant_recipients.includes("grant funding"));
  });
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

  it("defines canonical sector groups for cross-source queue matching (F197)", () => {
    // Single source of truth lives with the matcher in visible-clients.ts;
    // these assertions pin the aliases the presets rely on.
    assert.ok(CANONICAL_SECTOR_GROUPS.health.includes("healthcare"));
    assert.ok(CANONICAL_SECTOR_GROUPS.education.includes("school"));
    assert.ok(CANONICAL_SECTOR_GROUPS.environment.includes("sustainability"));
    assert.ok(CANONICAL_SECTOR_GROUPS.poverty.includes("homeless"));
  });
});
