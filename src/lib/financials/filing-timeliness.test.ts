import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyFilingSpeed,
  computeFilingTimeliness,
  STATUTORY_DEADLINE_DAYS,
} from "./filing-timeliness.ts";

describe("classifyFilingSpeed", () => {
  it("classifies <= 180 days as prompt", () => {
    assert.equal(classifyFilingSpeed(110), "prompt");
    assert.equal(classifyFilingSpeed(180), "prompt");
  });

  it("classifies 181-270 days as on_time", () => {
    assert.equal(classifyFilingSpeed(181), "on_time");
    assert.equal(classifyFilingSpeed(250), "on_time");
    assert.equal(classifyFilingSpeed(270), "on_time");
  });

  it("classifies 271-305 days as near_deadline", () => {
    assert.equal(classifyFilingSpeed(271), "near_deadline");
    assert.equal(classifyFilingSpeed(300), "near_deadline");
    assert.equal(classifyFilingSpeed(STATUTORY_DEADLINE_DAYS), "near_deadline");
  });

  it("classifies > 305 days as late", () => {
    assert.equal(classifyFilingSpeed(306), "late");
    assert.equal(classifyFilingSpeed(365), "late");
  });
});

describe("computeFilingTimeliness", () => {
  it("returns null for empty periods", () => {
    assert.equal(computeFilingTimeliness({ periods: [] }), null);
  });

  it("computes prompt health for prompt filer", () => {
    const summary = computeFilingTimeliness({
      periods: [
        { period_end: "2024-03-31", filing_date: "2024-07-29" }, // 120 days
        { period_end: "2023-03-31", filing_date: "2023-08-08" }, // 130 days
      ],
      reportingStatus: "Submission Received",
    });

    assert.ok(summary);
    assert.equal(summary.totalWithFilingDate, 2);
    assert.equal(summary.averageDays, 125);
    assert.equal(summary.lateCount, 0);
    assert.equal(summary.promptCount, 2);
    assert.equal(summary.healthTone, "go");
    assert.equal(summary.healthBadge, "Prompt filer");
    assert.equal(summary.isOverdue, false);
  });

  it("detects overdue when status says Overdue", () => {
    const summary = computeFilingTimeliness({
      periods: [{ period_end: "2023-03-31", filing_date: "2023-08-08" }],
      reportingStatus: "Overdue",
    });

    assert.ok(summary);
    assert.equal(summary.healthTone, "stop");
    assert.equal(summary.healthBadge, "Overdue");
    assert.equal(summary.isOverdue, true);
  });

  it("detects filing delay when past filings were late", () => {
    const summary = computeFilingTimeliness({
      periods: [
        { period_end: "2024-03-31", filing_date: "2025-02-15" }, // 321 days (late)
        { period_end: "2023-03-31", filing_date: "2023-11-20" }, // 234 days
      ],
    });

    assert.ok(summary);
    assert.equal(summary.lateCount, 1);
    assert.equal(summary.healthTone, "hold");
    assert.equal(summary.healthBadge, "Filing delay");
  });

  it("handles periods without filing_date gracefully", () => {
    const summary = computeFilingTimeliness({
      periods: [{ period_end: "2024-03-31", filing_date: null }],
      reportingStatus: "New",
      now: new Date("2024-06-01T00:00:00Z"),
    });

    assert.ok(summary);
    assert.equal(summary.totalWithFilingDate, 0);
    assert.equal(summary.averageDays, null);
    assert.equal(summary.healthBadge, "New");
    assert.equal(summary.isOverdue, false);
  });
});
