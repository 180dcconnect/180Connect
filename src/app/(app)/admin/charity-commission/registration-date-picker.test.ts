import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatRegistrationDate,
  formatRegistrationRange,
  getRegistrationPresets,
  isValidIsoDate,
} from "./registration-date.ts";

describe("isValidIsoDate", () => {
  it("accepts valid ISO days", () => {
    assert.equal(isValidIsoDate("2024-01-01"), true);
    assert.equal(isValidIsoDate("2020-02-29"), true); // leap year
    assert.equal(isValidIsoDate("1999-12-31"), true);
  });

  it("rejects non-ISO or invalid dates", () => {
    assert.equal(isValidIsoDate("2023-02-29"), false); // not a leap year
    assert.equal(isValidIsoDate("2024-13-01"), false); // month 13
    assert.equal(isValidIsoDate("2024-04-31"), false); // April has 30 days
    assert.equal(isValidIsoDate("01/01/2024"), false);
    assert.equal(isValidIsoDate("2024-1-1"), false);
    assert.equal(isValidIsoDate(""), false);
    assert.equal(isValidIsoDate("invalid"), false);
  });
});

describe("formatRegistrationDate", () => {
  it("formats valid ISO day string to en-GB", () => {
    assert.equal(formatRegistrationDate("2024-05-12"), "12 May 2024");
    assert.equal(formatRegistrationDate("2020-01-01"), "1 Jan 2020");
  });

  it("returns empty string for null or invalid inputs", () => {
    assert.equal(formatRegistrationDate(null), "");
    assert.equal(formatRegistrationDate(undefined), "");
    assert.equal(formatRegistrationDate("invalid"), "");
  });
});

describe("formatRegistrationRange", () => {
  it("formats complete range when both ends are provided", () => {
    assert.equal(
      formatRegistrationRange("2020-01-01", "2024-12-31"),
      "1 Jan 2020 – 31 Dec 2024",
    );
  });

  it("formats start-only filter", () => {
    assert.equal(formatRegistrationRange("2022-06-15", null), "From 15 Jun 2022");
    assert.equal(formatRegistrationRange("2022-06-15", undefined), "From 15 Jun 2022");
  });

  it("formats end-only filter", () => {
    assert.equal(formatRegistrationRange(null, "2019-12-31"), "Up to 31 Dec 2019");
    assert.equal(formatRegistrationRange(undefined, "2019-12-31"), "Up to 31 Dec 2019");
  });

  it("formats all registration dates when neither end is provided", () => {
    assert.equal(formatRegistrationRange(null, null), "All registration dates");
    assert.equal(formatRegistrationRange("", ""), "All registration dates");
  });
});

describe("getRegistrationPresets", () => {
  it("returns presets with valid structure and relative dates", () => {
    const fixedNow = new Date("2026-09-04T12:00:00Z");
    const presets = getRegistrationPresets(fixedNow);
    assert.equal(presets.length, 5);
    assert.equal(presets[0].label, "Past 12m");
    assert.equal(presets[0].to, "2026-09-04");
    assert.equal(presets[0].from, "2025-09-04");

    const since2020 = presets.find((p) => p.label === "Since 2020");
    assert.equal(since2020?.from, "2020-01-01");
    assert.equal(since2020?.to, "2026-09-04");

    const pre2015 = presets.find((p) => p.label === "Pre-2015");
    assert.equal(pre2015?.from, null);
    assert.equal(pre2015?.to, "2014-12-31");
  });
});
