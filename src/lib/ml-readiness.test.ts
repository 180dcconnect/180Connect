import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MINIMUM_OUTCOME_THRESHOLD,
  groupOutcomes,
  outcomeReadiness,
  type OutcomeRow,
} from "./ml-readiness.ts";

test("MINIMUM_OUTCOME_THRESHOLD is the PM-confirmed minimum", () => {
  // Changing the number changes what admins see and what the acceptance
  // criteria promise — this guards against an accidental edit.
  assert.equal(MINIMUM_OUTCOME_THRESHOLD, 50);
});

test("the human line is contextualised, not a raw count", () => {
  const r = outcomeReadiness(32);
  assert.equal(r.label, "32 of 50 client outcomes");
  assert.equal(r.remaining, 18);
  assert.equal(r.met, false);
  assert.equal(r.percent, 64);
});

test("the threshold-met line is explicit", () => {
  const r = outcomeReadiness(50);
  assert.equal(r.met, true);
  assert.equal(r.label, "50 of 50 client outcomes — target met");
  assert.equal(r.remaining, 0);
  assert.equal(r.percent, 100);
});

test("overflow caps the progress bar and keeps the label honest", () => {
  const r = outcomeReadiness(80);
  assert.equal(r.met, true);
  assert.equal(r.percent, 100);
  assert.equal(r.label, "80 of 50 client outcomes — target met");
});

test("zero and negatives degrade gracefully", () => {
  assert.equal(outcomeReadiness(0).label, "0 of 50 client outcomes");
  // A negative stored count should never happen, but the label must not read
  // "-1 of 50".
  assert.equal(outcomeReadiness(-5).labelledCount, 0);
});

// ---------------------------------------------------------------------------
// The breakdown
// ---------------------------------------------------------------------------

const outcome = (overrides: Partial<OutcomeRow> = {}): OutcomeRow => ({
  outcome_label: "converted",
  organisation_id: "org-1",
  organisation_sector: "Education",
  outcome_recorded_at: "2026-09-04T10:00:00.000Z",
  ...overrides,
});

const clientNames = new Map([
  ["org-1", "Sheffield Mind"],
  ["org-2", "Leeds Food Bank"],
]);

test("groupOutcomes counts each bucket, biggest first", () => {
  const rows = [
    outcome({ outcome_label: "converted" }),
    outcome({ outcome_label: "converted" }),
    outcome({ outcome_label: "no_response" }),
  ];
  assert.deepEqual(groupOutcomes(rows, "type"), [
    { label: "Converted", count: 2 },
    { label: "No response", count: 1 },
  ]);
});

test("stored tokens read as words, not database values", () => {
  const groups = groupOutcomes([outcome({ outcome_label: "soft_no" })], "type");
  assert.equal(groups[0].label, "Soft no");
});

test("clients are named from the map the caller passed in, never by id", () => {
  const groups = groupOutcomes(
    [outcome({ organisation_id: "org-2" }), outcome({ organisation_id: "org-1" })],
    "client",
    clientNames,
  );
  // One outcome each: same count, so they fall back to alphabetical order.
  assert.deepEqual(groups.map((group) => group.label), ["Leeds Food Bank", "Sheffield Mind"]);
  assert.ok(groups.every((group) => !group.label.includes("org-")));
});

test("a client with no name on the row still gets words", () => {
  const groups = groupOutcomes([outcome({ organisation_id: "org-9" })], "client", clientNames);
  assert.equal(groups[0].label, "Client not on file");
});

test("sector buckets fall back to a plain-English gap", () => {
  const groups = groupOutcomes(
    [outcome({ organisation_sector: null }), outcome({ organisation_sector: "  " })],
    "sector",
  );
  assert.deepEqual(groups, [{ label: "Sector not recorded", count: 2 }]);
});

test("months are labelled in UTC, so one outcome cannot land in two months", () => {
  // 23:30 UTC on 31 August is September in a +02:00 zone. Read in UTC it stays August.
  const groups = groupOutcomes([outcome({ outcome_recorded_at: "2026-08-31T23:30:00.000Z" })], "month");
  assert.equal(groups[0].label, "August 2026");
});

test("an outcome with no timestamp is a gap, not a dropped row", () => {
  const groups = groupOutcomes(
    [outcome({ outcome_recorded_at: null }), outcome({ outcome_recorded_at: "nonsense" })],
    "month",
  );
  assert.deepEqual(groups, [{ label: "Month not recorded", count: 2 }]);
});

test("ties are broken alphabetically so the order never wobbles", () => {
  const groups = groupOutcomes(
    [
      outcome({ outcome_label: "no_response" }),
      outcome({ outcome_label: "converted" }),
    ],
    "type",
  );
  assert.deepEqual(groups.map((group) => group.label), ["Converted", "No response"]);
});

test("no rows is no groups, not a phantom bucket", () => {
  assert.deepEqual(groupOutcomes([], "type"), []);
  assert.deepEqual(groupOutcomes([], "client", clientNames), []);
});
