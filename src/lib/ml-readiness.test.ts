import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MINIMUM_OUTCOME_THRESHOLD,
  outcomeReadiness,
} from "./ml-readiness.ts";

test("MINIMUM_OUTCOME_THRESHOLD is the PM-confirmed minimum", () => {
  // Changing the number changes what admins see and what the acceptance
  // criteria promise — this guards against an accidental edit.
  assert.equal(MINIMUM_OUTCOME_THRESHOLD, 50);
});

test("the human line is contextualised, not a raw count", () => {
  const r = outcomeReadiness(32);
  assert.equal(r.label, "32 of 50 minimum outcomes");
  assert.equal(r.remaining, 18);
  assert.equal(r.met, false);
  assert.equal(r.percent, 64);
});

test("the threshold-met line is explicit", () => {
  const r = outcomeReadiness(50);
  assert.equal(r.met, true);
  assert.equal(r.label, "50 of 50 minimum outcomes — threshold met");
  assert.equal(r.remaining, 0);
  assert.equal(r.percent, 100);
});

test("overflow caps the progress bar and keeps the label honest", () => {
  const r = outcomeReadiness(80);
  assert.equal(r.met, true);
  assert.equal(r.percent, 100);
  assert.equal(r.label, "80 of 50 minimum outcomes — threshold met");
});

test("zero and negatives degrade gracefully", () => {
  assert.equal(outcomeReadiness(0).label, "0 of 50 minimum outcomes");
  // A negative stored count should never happen, but the label must not read
  // "-1 of 50".
  assert.equal(outcomeReadiness(-5).labelledCount, 0);
});
