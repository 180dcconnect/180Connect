import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conversionRanges,
  conversionsDelta,
  conversionsOverTime,
  conversionsTotal,
  type ConversionRange,
  type ConversionRow,
} from "./conversions-over-time.ts";

// A Thursday, mid-month, mid-quarter — so month-to-date, quarter-to-date and
// the trailing year are all non-degenerate.
const NOW = new Date("2026-09-10T12:00:00Z");

function row(createdAt: string, organisationId = "org-1", userId: string | null = "user-a"): ConversionRow {
  return { created_at: createdAt, organisation_id: organisationId, recorded_by_user_id: userId };
}

const rangeOf = (key: ConversionRange["key"]) =>
  conversionRanges(NOW).find((range) => range.key === key)!;

describe("conversionRanges", () => {
  it("offers month-to-date by day, quarter-to-date by week, trailing year by month", () => {
    const ranges = conversionRanges(NOW);
    assert.deepEqual(
      ranges.map((range) => [range.key, range.granularity, range.from, range.to]),
      [
        ["month", "day", "2026-09-01", "2026-09-10"],
        ["quarter", "week", "2026-07-01", "2026-09-10"],
        ["year", "month", "2025-10-01", "2026-09-10"],
      ],
    );
  });

  it("rolls the trailing year back across the year boundary", () => {
    const ranges = conversionRanges(new Date("2026-02-05T00:00:00Z"));
    assert.equal(ranges.find((range) => range.key === "year")!.from, "2025-03-01");
  });
});

describe("conversionsOverTime", () => {
  it("returns one point per day across month-to-date, zeros included", () => {
    const points = conversionsOverTime([row("2026-09-03T09:00:00Z")], rangeOf("month"));
    assert.equal(points.length, 10);
    assert.deepEqual(points[0], { value: 0, date: "2026-09-01" });
    assert.deepEqual(points[2], { value: 1, date: "2026-09-03" });
    assert.equal(conversionsTotal(points), 1);
  });

  it("counts distinct organisations, not outcome rows", () => {
    const points = conversionsOverTime(
      [
        row("2026-09-03T09:00:00Z", "org-1"),
        row("2026-09-03T18:00:00Z", "org-1"),
        row("2026-09-03T19:00:00Z", "org-2"),
      ],
      rangeOf("month"),
    );
    assert.equal(points[2].value, 2);
  });

  it("buckets by Monday-start week for the quarter range", () => {
    // 2026-09-10 is a Thursday; its ISO week starts Monday 2026-09-07.
    const points = conversionsOverTime([row("2026-09-10T09:00:00Z")], rangeOf("quarter"));
    const nonZero = points.filter((point) => point.value > 0);
    assert.deepEqual(nonZero, [{ value: 1, date: "2026-09-07" }]);
    // 1 Jul 2026 is a Wednesday, so the first bucket is the Monday before it.
    assert.equal(points[0].date, "2026-06-29");
  });

  it("buckets by calendar month for the trailing year and returns 12 points", () => {
    const points = conversionsOverTime(
      [row("2025-11-20T00:00:00Z", "org-1"), row("2026-09-02T00:00:00Z", "org-2")],
      rangeOf("year"),
    );
    assert.equal(points.length, 12);
    assert.equal(points[0].date, "2025-10-01");
    assert.equal(points.at(-1)!.date, "2026-09-01");
    assert.equal(points.find((point) => point.date === "2025-11-01")!.value, 1);
    assert.equal(conversionsTotal(points), 2);
  });

  it("excludes rows outside the range at both ends", () => {
    const points = conversionsOverTime(
      [row("2026-08-31T23:59:59Z", "org-1"), row("2026-09-11T00:00:00Z", "org-2")],
      rangeOf("month"),
    );
    assert.equal(conversionsTotal(points), 0);
  });

  it("includes a conversion at the last instant of the final day", () => {
    const points = conversionsOverTime([row("2026-09-10T23:59:59Z")], rangeOf("month"));
    assert.equal(points.at(-1)!.value, 1);
  });

  it("is team-wide unless a user filter is passed", () => {
    const rows = [row("2026-09-02T00:00:00Z", "org-1", "user-a"), row("2026-09-03T00:00:00Z", "org-2", "user-b")];
    assert.equal(conversionsTotal(conversionsOverTime(rows, rangeOf("month"))), 2);
    assert.equal(conversionsTotal(conversionsOverTime(rows, rangeOf("month"), "user-a")), 1);
  });

  it("skips unparseable timestamps rather than throwing", () => {
    const points = conversionsOverTime(
      [row("not-a-date"), row("2026-09-04T00:00:00Z", "org-2")],
      rangeOf("month"),
    );
    assert.equal(conversionsTotal(points), 1);
  });

  it("returns nothing for an inverted range", () => {
    const bad: ConversionRange = {
      key: "month",
      label: "Bad",
      granularity: "day",
      from: "2026-09-10",
      to: "2026-09-01",
    };
    assert.deepEqual(conversionsOverTime([row("2026-09-05T00:00:00Z")], bad), []);
  });
});

describe("conversionsDelta", () => {
  it("compares against the immediately preceding stretch of equal length", () => {
    // Month-to-date on 10 Sept spans 10 days, so the prior stretch is 22-31 Aug.
    const delta = conversionsDelta(
      [
        row("2026-09-02T00:00:00Z", "org-1"),
        row("2026-09-05T00:00:00Z", "org-2"),
        row("2026-08-25T00:00:00Z", "org-3"),
      ],
      rangeOf("month"),
    );
    assert.deepEqual(delta, { current: 2, previous: 1 });
  });

  it("counts distinct organisations on both sides", () => {
    const delta = conversionsDelta(
      [row("2026-09-02T00:00:00Z", "org-1"), row("2026-09-06T00:00:00Z", "org-1")],
      rangeOf("month"),
    );
    assert.deepEqual(delta, { current: 1, previous: 0 });
  });

  it("honours the user filter", () => {
    const delta = conversionsDelta(
      [row("2026-09-02T00:00:00Z", "org-1", "user-a"), row("2026-09-03T00:00:00Z", "org-2", "user-b")],
      rangeOf("month"),
      "user-b",
    );
    assert.deepEqual(delta, { current: 1, previous: 0 });
  });
});
