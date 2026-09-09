import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveIncomeBand,
  formatCompactGbp,
  formatGbp,
  INCOME_BAND_DESCRIPTIONS,
  INCOME_BAND_LABELS,
  INCOME_BAND_OPTIONS,
  INCOME_BAND_SHORT_NAMES,
} from "./income-band.ts";

describe("income-band constants", () => {
  it("has exactly 4 discrete income bands in ascending order", () => {
    assert.deepEqual(INCOME_BAND_OPTIONS, [
      "under_10k",
      "10k_100k",
      "100k_1m",
      "over_1m",
    ]);
  });

  it("provides labels, descriptions, and short names for each band", () => {
    for (const band of INCOME_BAND_OPTIONS) {
      assert.ok(INCOME_BAND_LABELS[band]);
      assert.ok(INCOME_BAND_DESCRIPTIONS[band]);
      assert.ok(INCOME_BAND_SHORT_NAMES[band]);
    }
  });
});

describe("deriveIncomeBand", () => {
  it("correctly derives bands based on thresholds", () => {
    assert.equal(deriveIncomeBand(0), "under_10k");
    assert.equal(deriveIncomeBand(9_999), "under_10k");
    assert.equal(deriveIncomeBand(10_000), "10k_100k");
    assert.equal(deriveIncomeBand(100_000), "10k_100k");
    assert.equal(deriveIncomeBand(100_001), "100k_1m");
    assert.equal(deriveIncomeBand(1_000_000), "100k_1m");
    assert.equal(deriveIncomeBand(1_000_001), "over_1m");
    assert.equal(deriveIncomeBand(50_000_000), "over_1m");
  });

  it("returns null for null, undefined, or NaN", () => {
    assert.equal(deriveIncomeBand(null), null);
    assert.equal(deriveIncomeBand(undefined), null);
    assert.equal(deriveIncomeBand(Number.NaN), null);
  });
});

describe("formatGbp", () => {
  it("formats GBP currency without decimals", () => {
    assert.equal(formatGbp(450_000), "£450,000");
    assert.equal(formatGbp(10_000), "£10,000");
    assert.equal(formatGbp(0), "£0");
  });

  it("handles null and undefined with fallback text", () => {
    assert.equal(formatGbp(null), "Not disclosed");
    assert.equal(formatGbp(undefined), "Not disclosed");
  });
});

describe("formatCompactGbp", () => {
  it("formats compact values appropriately", () => {
    assert.equal(formatCompactGbp(1_500_000), "£1.5m");
    assert.equal(formatCompactGbp(1_000_000), "£1m");
    assert.equal(formatCompactGbp(450_000), "£450k");
    assert.equal(formatCompactGbp(9_500), "£10k");
    assert.equal(formatCompactGbp(500), "£500");
  });

  it("handles negative amounts", () => {
    assert.equal(formatCompactGbp(-50_000), "-£50k");
    assert.equal(formatCompactGbp(-1_200_000), "-£1.2m");
  });

  it("handles null and undefined", () => {
    assert.equal(formatCompactGbp(null), "Not disclosed");
  });
});
