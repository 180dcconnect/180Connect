import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldTransitionToResponded } from "./responded-status.ts";

describe("shouldTransitionToResponded — valid transitions (AC1)", () => {
  it("allows the transition from not_contacted", () => {
    assert.equal(shouldTransitionToResponded("not_contacted"), true);
  });

  it("allows the transition from initial_outreach_sent", () => {
    assert.equal(shouldTransitionToResponded("initial_outreach_sent"), true);
  });

  it("allows the transition from follow_up_sent", () => {
    assert.equal(shouldTransitionToResponded("follow_up_sent"), true);
  });
});

describe("shouldTransitionToResponded — already responded", () => {
  it("is a no-op, not a fresh transition, matching set_outreach_status's own convention", () => {
    assert.equal(shouldTransitionToResponded("responded"), false);
  });
});

describe("shouldTransitionToResponded — never overrides a manual, final decision (AC2)", () => {
  const manualStatuses = [
    "converted",
    "future_potential",
    "soft_no",
    "hard_no",
    "no_response",
    "loss_due_timing",
  ] as const;

  for (const status of manualStatuses) {
    it(`refuses to override ${status}`, () => {
      assert.equal(shouldTransitionToResponded(status), false);
    });
  }
});
