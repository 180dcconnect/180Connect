import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scoreByPreviousContact } from "./score-by-previous-contact.ts";

const NOW = new Date("2026-08-26T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe("scoreByPreviousContact — complete client data (AC1/AC3)", () => {
  it("ranks statuses in the confirmed ideology order", () => {
    const expectedOrder = [
      "converted",
      "future_potential",
      "responded",
      "not_contacted",
      "loss_due_timing",
      "initial_outreach_sent",
      "follow_up_sent",
      "no_response",
      "soft_no",
      "hard_no",
    ];
    for (let i = 1; i < expectedOrder.length; i += 1) {
      const higher = scoreByPreviousContact(expectedOrder[i - 1], null, NOW);
      const lower = scoreByPreviousContact(expectedOrder[i], null, NOW);
      // >= rather than >: loss_due_timing and pending outreach intentionally
      // share the neutral 0.5 — only the ideology-critical gaps are strict,
      // and those have their own assertions below.
      assert.ok(
        higher.score >= lower.score,
        `${expectedOrder[i - 1]} (${higher.score}) must not rank under ${expectedOrder[i]} (${lower.score})`,
      );
    }
  });

  it("scores a converted client highest and never penalises them like a rejection (AC3)", () => {
    assert.equal(scoreByPreviousContact("converted", null, NOW).score, 1.0);
    assert.ok(
      scoreByPreviousContact("converted", null, NOW).score >
        scoreByPreviousContact("hard_no", null, NOW).score,
    );
  });

  it("ranks future_potential above never-contacted: deliberate shortlisting beats unqualified anyone", () => {
    assert.ok(
      scoreByPreviousContact("future_potential", null, NOW).score >
        scoreByPreviousContact("not_contacted", null, NOW).score,
    );
  });

  it("a hard-no or recently-chased client scores below one we have never contacted (AC1)", () => {
    const untouched = scoreByPreviousContact("not_contacted", null, NOW);
    const chased = scoreByPreviousContact(
      "follow_up_sent",
      daysAgo(2),
      NOW,
    );
    const rejected = scoreByPreviousContact("hard_no", null, NOW);
    assert.ok(chased.score < untouched.score);
    assert.ok(rejected.score < untouched.score);
  });

  it("every known status lands inside the documented 0-1 range", () => {
    for (const status of [
      "converted",
      "future_potential",
      "responded",
      "not_contacted",
      "loss_due_timing",
      "initial_outreach_sent",
      "follow_up_sent",
      "no_response",
      "soft_no",
      "hard_no",
    ]) {
      const result = scoreByPreviousContact(status, daysAgo(0), NOW);
      assert.ok(result.score >= 0 && result.score <= 1, status);
    }
  });
});

describe("scoreByPreviousContact — recency decay on unresolved contact (AC1)", () => {
  it("sinks a follow-up sent today to the recent floor", () => {
    const result = scoreByPreviousContact(
      "follow_up_sent",
      daysAgo(0),
      NOW,
    );
    assert.equal(result.recencyApplied, true);
    assert.equal(result.score, 0.25);
  });

  it("recovers linearly to the status base across the 30-day window", () => {
    const at15Days = scoreByPreviousContact("no_response", daysAgo(15), NOW);
    // Halfway between the floor (0.25) and no_response's base (0.35).
    assert.ok(Math.abs(at15Days.score - 0.3) < 1e-9);
    assert.equal(at15Days.recencyApplied, true);

    const at30Days = scoreByPreviousContact(
      "no_response",
      daysAgo(30),
      NOW,
    );
    assert.equal(at30Days.score, 0.35);
    assert.equal(at30Days.recencyApplied, false);
  });

  it("older-than-window contacts simply get their status base back", () => {
    const old = scoreByPreviousContact(
      "initial_outreach_sent",
      daysAgo(90),
      NOW,
    );
    assert.equal(old.score, 0.5);
    assert.equal(old.recencyApplied, false);
  });

  it("decay only touches unresolved statuses — resolved verdicts are immune to age", () => {
    for (const status of ["converted", "responded", "soft_no", "hard_no"]) {
      const fresh = scoreByPreviousContact(status, daysAgo(0), NOW);
      const stale = scoreByPreviousContact(status, daysAgo(365), NOW);
      assert.equal(fresh.score, stale.score, status);
      assert.equal(fresh.recencyApplied, false, status);
    }
  });

  it("treats a future-dated timestamp as today rather than boosting above the floor", () => {
    const future = scoreByPreviousContact(
      "follow_up_sent",
      daysAgo(-3),
      NOW,
    );
    assert.equal(future.score, 0.25);
  });
});

describe("scoreByPreviousContact — missing scoring inputs (AC3)", () => {
  it("an unknown status degrades to neutral instead of throwing or scoring as engaged", () => {
    const result = scoreByPreviousContact("mystery_status", null, NOW);
    assert.equal(result.score, 0.5);
    assert.equal(result.hasPriorContact, false);
  });

  it("not_contacted is explicitly flagged as having no prior contact", () => {
    const result = scoreByPreviousContact("not_contacted", null, NOW);
    assert.equal(result.hasPriorContact, false);
    assert.equal(result.score, 0.7);
  });

  it("engaged statuses are flagged as prior contact even without a timestamp", () => {
    const result = scoreByPreviousContact("responded", undefined, NOW);
    assert.equal(result.hasPriorContact, true);
    assert.equal(result.recencyApplied, false);
  });

  it("an unparseable timestamp is ignored — status-only scoring stands", () => {
    const result = scoreByPreviousContact("no_response", "not-a-date", NOW);
    assert.equal(result.score, 0.35);
    assert.equal(result.recencyApplied, false);
  });

  it("changed input data recalculates: a newer message lowers an unresolved score", () => {
    const before = scoreByPreviousContact(
      "follow_up_sent",
      daysAgo(25),
      NOW,
    );
    const after = scoreByPreviousContact("follow_up_sent", daysAgo(3), NOW);
    assert.ok(after.score < before.score);
  });
});
