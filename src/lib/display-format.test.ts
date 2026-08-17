import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dayKeyOf,
  formatDayLabel,
  formatDuration,
  formatRelativeTime,
  groupByDay,
  humaniseToken,
} from "./display-format.ts";

const NOW = new Date("2026-08-15T12:00:00.000Z");

describe("humaniseToken", () => {
  it("turns a snake_case token into a readable label", () => {
    assert.equal(humaniseToken("invite_cancelled"), "Invite cancelled");
    assert.equal(humaniseToken("companies_house"), "Companies house");
  });

  it("survives a token with no underscore, and an empty one", () => {
    assert.equal(humaniseToken("converted"), "Converted");
    assert.equal(humaniseToken(""), "");
  });
});

describe("formatRelativeTime", () => {
  const at = (iso: string) => formatRelativeTime(new Date(iso), NOW);

  it("rounds the recent past into plain English", () => {
    assert.equal(at("2026-08-15T11:59:40.000Z"), "Just now");
    assert.equal(at("2026-08-15T11:59:00.000Z"), "1 minute ago");
    assert.equal(at("2026-08-15T11:30:00.000Z"), "30 minutes ago");
    assert.equal(at("2026-08-15T09:00:00.000Z"), "3 hours ago");
    assert.equal(at("2026-08-13T12:00:00.000Z"), "2 days ago");
  });

  it("gives the calendar date once a week has passed", () => {
    assert.equal(at("2026-07-01T12:00:00.000Z"), "1 July");
  });

  it("does not report a clock-skewed future stamp as negative", () => {
    assert.equal(at("2026-08-15T12:05:00.000Z"), "Just now");
  });
});

describe("formatDuration", () => {
  it("uses the largest unit that still says something", () => {
    assert.equal(formatDuration(4_000), "4s");
    assert.equal(formatDuration(59_000), "59s");
    assert.equal(formatDuration(134_000), "2m 14s");
    assert.equal(formatDuration(3 * 3_600_000 + 25 * 60_000), "3h 25m");
  });

  it("refuses to invent a duration it does not have", () => {
    assert.equal(formatDuration(-1), "—");
    assert.equal(formatDuration(Number.NaN), "—");
  });

  it("reports a sub-second run as zero rather than blank", () => {
    assert.equal(formatDuration(300), "0s");
  });
});

describe("formatDayLabel", () => {
  // Built from local components, not an ISO string: these labels are about the
  // *local* calendar, so a UTC literal would land on a different day for anyone
  // running the suite outside UTC.
  it("labels the two most recent days in words", () => {
    const today = new Date(NOW);
    const yesterday = new Date(NOW);
    yesterday.setDate(yesterday.getDate() - 1);
    assert.equal(formatDayLabel(today, NOW), "Today");
    assert.equal(formatDayLabel(yesterday, NOW), "Yesterday");
  });

  it("drops the year within the current one and keeps it otherwise", () => {
    assert.equal(formatDayLabel(new Date("2026-03-04T12:00:00.000Z"), NOW), "4 March");
    assert.equal(formatDayLabel(new Date("2025-03-04T12:00:00.000Z"), NOW), "4 March 2025");
  });
});

describe("groupByDay", () => {
  const item = (id: string, day: string) => ({ id, dayKey: day, dayLabel: day });

  it("splits at each calendar day, keeping order", () => {
    const groups = groupByDay([
      item("a", "2026-08-15"),
      item("b", "2026-08-15"),
      item("c", "2026-08-14"),
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].events.map((event) => event.id), ["a", "b"]);
    assert.deepEqual(groups[1].events.map((event) => event.id), ["c"]);
  });

  it("returns nothing for an empty list", () => {
    assert.deepEqual(groupByDay([]), []);
  });
});

describe("dayKeyOf", () => {
  it("keys on the local calendar date, zero-padded", () => {
    assert.equal(dayKeyOf(new Date(2026, 0, 5)), "2026-01-05");
  });
});
