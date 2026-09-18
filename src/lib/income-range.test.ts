import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INCOME_STOPS,
  INCOME_STOP_HISTOGRAM,
  INCOME_STOP_POSITIONS,
  incomeMaxAtPosition,
  incomeMinAtPosition,
  incomeStopLabel,
  positionForIncomeMax,
  positionForIncomeMin,
  INCOME_RANGE_MAX_PLUS,
  bandsForIncomeRange,
  describeIncomeRange,
  formatIncome,
  formatIncomeSliderLabel,
  incomeInRange,
  incomeRangeFromBands,
  isIncomeRangeActive,
  parseIncomeBound,
} from "./income-range.ts";

describe("formatting", () => {
  it("formats pounds compactly", () => {
    assert.equal(formatIncome(0), "£0");
    assert.equal(formatIncome(25_000), "£25k");
    assert.equal(formatIncome(1_500_000), "£1.5m");
    assert.equal(formatIncome(2_000_000), "£2m");
    assert.equal(formatIncomeSliderLabel(INCOME_RANGE_MAX_PLUS), "£5m+");
  });

  it("describes a range, or nothing for no preference", () => {
    assert.equal(describeIncomeRange({ min: null, max: null }), null);
    assert.equal(describeIncomeRange({ min: 250_000, max: 2_000_000 }), "£250k – £2m");
    assert.equal(describeIncomeRange({ min: 100_000, max: null }), "£100k+");
    assert.equal(describeIncomeRange({ min: null, max: 50_000 }), "Up to £50k");
  });
});

describe("incomeInRange", () => {
  it("is inclusive at both ends", () => {
    const range = { min: 250_000, max: 2_000_000 };
    assert.equal(incomeInRange(250_000, range), true);
    assert.equal(incomeInRange(2_000_000, range), true);
    assert.equal(incomeInRange(249_999, range), false);
    assert.equal(incomeInRange(2_000_001, range), false);
  });

  it("never matches a client with no filed income", () => {
    assert.equal(incomeInRange(null, { min: null, max: 100_000 }), false);
    assert.equal(incomeInRange(undefined, { min: 10, max: null }), false);
  });

  it("treats a missing bound as open", () => {
    assert.equal(incomeInRange(9_000_000, { min: 1_000_000, max: null }), true);
    assert.equal(isIncomeRangeActive({ min: null, max: null }), false);
  });
});

describe("bands, for the legacy column", () => {
  it("lists the bands a range overlaps", () => {
    assert.deepEqual(bandsForIncomeRange({ min: 250_000, max: 2_000_000 }), [
      "100k_500k",
      "500k_1m",
      "1m_10m",
    ]);
    assert.deepEqual(bandsForIncomeRange({ min: 10_000, max: 100_000 }), ["10k_100k"]);
    assert.deepEqual(bandsForIncomeRange({ min: null, max: null }), []);
  });

  it("turns saved bands into the range they cover, matching the migration", () => {
    assert.deepEqual(incomeRangeFromBands(["10k_100k", "100k_500k"]), {
      min: 10_000,
      max: 500_000,
    });
    assert.deepEqual(incomeRangeFromBands(["under_10k"]), { min: null, max: 10_000 });
    assert.deepEqual(incomeRangeFromBands(["over_100m"]), { min: 100_000_000, max: null });
    assert.deepEqual(incomeRangeFromBands([]), { min: null, max: null });
  });
});

describe("relative stops", () => {
  it("has a bar for every slider position and stops in increasing order", () => {
    assert.equal(INCOME_STOP_HISTOGRAM.length, INCOME_STOP_POSITIONS);
    for (let i = 1; i < INCOME_STOPS.length; i++) {
      assert.ok(INCOME_STOPS[i] > INCOME_STOPS[i - 1]);
    }
  });

  it("is finer below £1m than above it", () => {
    const belowMillion = INCOME_STOPS.filter((stop) => stop < 1_000_000).length;
    const aboveMillion = INCOME_STOPS.filter((stop) => stop > 1_000_000).length;
    assert.ok(belowMillion > aboveMillion * 3);
  });

  it("round-trips unbounded ends", () => {
    assert.equal(positionForIncomeMin(null), 0);
    assert.equal(incomeMinAtPosition(0), null);
    assert.equal(positionForIncomeMax(null), INCOME_STOP_POSITIONS - 1);
    assert.equal(incomeMaxAtPosition(INCOME_STOP_POSITIONS - 1), null);
  });

  it("round-trips a value on a stop", () => {
    const position = positionForIncomeMin(250_000);
    assert.equal(incomeMinAtPosition(position), 250_000);
    assert.equal(incomeMaxAtPosition(positionForIncomeMax(10_000)), 10_000);
  });

  it("snaps a value between stops to the nearest", () => {
    assert.equal(incomeMaxAtPosition(positionForIncomeMax(90_000)), 100_000);
    assert.equal(incomeMinAtPosition(positionForIncomeMin(30_000)), 25_000);
  });

  it("labels positions for the big value display", () => {
    assert.equal(incomeStopLabel(0), "£0");
    assert.equal(incomeStopLabel(positionForIncomeMin(1_500_000)), "£1.5m");
    assert.equal(incomeStopLabel(INCOME_STOP_POSITIONS - 1), "No limit");
  });
});

describe("parseIncomeBound", () => {
  it("accepts whole non-negative pounds", () => {
    assert.equal(parseIncomeBound("250000", "min"), 250_000);
    assert.equal(parseIncomeBound(99.6, "max"), 100);
  });

  it("maps the slider's ends and junk to no bound", () => {
    assert.equal(parseIncomeBound("0", "min"), null);
    assert.equal(parseIncomeBound(INCOME_RANGE_MAX_PLUS, "max"), null);
    assert.equal(parseIncomeBound("-5", "min"), null);
    assert.equal(parseIncomeBound("abc", "max"), null);
    assert.equal(parseIncomeBound("", "max"), null);
  });
});
