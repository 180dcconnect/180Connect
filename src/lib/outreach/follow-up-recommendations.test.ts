import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FOLLOW_UP_THRESHOLDS,
  FOLLOW_UP_TRIGGER_STATUSES,
  followUpRecommendations,
  lastActivityAt,
} from "./follow-up-recommendations.ts";

const NOW = new Date("2026-09-15T12:00:00Z");

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function candidate(overrides: Partial<{ id: string; legal_name: string; outreach_status: string }> = {}) {
  return { id: "org-1", legal_name: "Alpha Charity", outreach_status: "follow_up_sent", ...overrides };
}

describe("FOLLOW_UP_TRIGGER_STATUSES (F160 scope, agreed 26 Aug 2026)", () => {
  it("covers all three agreed statuses — including Initial Outreach Sent", () => {
    assert.deepEqual([...FOLLOW_UP_TRIGGER_STATUSES].sort(), [
      "follow_up_sent",
      "initial_outreach_sent",
      "no_response",
    ]);
  });

  it("excludes every other pipeline status", () => {
    for (const status of [
      "not_contacted",
      "responded",
      "converted",
      "future_potential",
      "soft_no",
      "hard_no",
      "loss_due_timing",
    ]) {
      assert.ok(!FOLLOW_UP_TRIGGER_STATUSES.has(status), status);
    }
  });
});

describe("lastActivityAt (the activity clock)", () => {
  it("takes the LATEST of the three sources", () => {
    assert.equal(
      lastActivityAt({
        lastEmailSentAt: daysAgo(10),
        lastReplyReceivedAt: daysAgo(3),
        lastStatusChangeAt: daysAgo(6),
      }),
      daysAgo(3),
    );
  });

  it("works from any single source alone", () => {
    assert.equal(lastActivityAt({ lastStatusChangeAt: daysAgo(9) }), daysAgo(9));
  });

  it("ignores absent and unparseable timestamps rather than failing the clock", () => {
    assert.equal(
      lastActivityAt({ lastEmailSentAt: "not-a-date", lastReplyReceivedAt: daysAgo(2) }),
      daysAgo(2),
    );
    assert.equal(lastActivityAt({}), null);
    assert.equal(lastActivityAt({ lastEmailSentAt: null, lastReplyReceivedAt: undefined }), null);
  });
});

describe("followUpRecommendations", () => {
  const activity = (days: number | null) => {
    if (days === null) return new Map();
    return new Map([["org-1", { lastEmailSentAt: daysAgo(days) }]]);
  };

  it("stays quiet before the first threshold and surfaces at exactly day 7 (AC boundary)", () => {
    assert.deepEqual(followUpRecommendations([candidate()], activity(6), DEFAULT_FOLLOW_UP_THRESHOLDS, NOW), []);
    const due = followUpRecommendations([candidate()], activity(7), DEFAULT_FOLLOW_UP_THRESHOLDS, NOW);
    assert.equal(due.length, 1);
    assert.equal(due[0].urgency, "due");
    assert.equal(due[0].daysWaiting, 7);
  });

  it("keeps a client 'due' through day 13 and escalates at exactly day 14 (AC2 boundary)", () => {
    assert.equal(followUpRecommendations([candidate()], activity(13), DEFAULT_FOLLOW_UP_THRESHOLDS, NOW)[0].urgency, "due");
    assert.equal(followUpRecommendations([candidate()], activity(14), DEFAULT_FOLLOW_UP_THRESHOLDS, NOW)[0].urgency, "urgent");
  });

  it("uses the owner's preference thresholds, not hardcoded 7/14", () => {
    const slow = followUpRecommendations([candidate()], activity(10), { first: 14, second: 30 }, NOW);
    assert.deepEqual(slow, [], "day 10 is below this CAM's first threshold of 14");
    const escalated = followUpRecommendations([candidate()], activity(20), { first: 14, second: 30 }, NOW);
    assert.equal(escalated[0]?.urgency, "due");
  });

  it("folds inverted thresholds so 'due' always comes before 'urgent'", () => {
    // first=20 > second=10 would make due unreachable; the pair folds instead.
    const recs = followUpRecommendations([candidate()], activity(12), { first: 20, second: 10 }, NOW);
    assert.equal(recs[0]?.urgency, "due", "day 12 sits between the folded bounds 10..20");
    const late = followUpRecommendations([candidate()], activity(25), { first: 20, second: 10 }, NOW);
    assert.equal(late[0]?.urgency, "urgent");
  });

  it("ignores non-trigger statuses even when very stale", () => {
    for (const status of ["not_contacted", "responded", "converted"]) {
      assert.deepEqual(
        followUpRecommendations([candidate({ outreach_status: status })], activity(40), DEFAULT_FOLLOW_UP_THRESHOLDS, NOW),
        [],
        status,
      );
    }
  });

  it("skips a trigger-status client with no measurable activity rather than guessing silence", () => {
    assert.deepEqual(followUpRecommendations([candidate()], new Map()), []);
  });

  it("a recent reply resets the clock even though the email is old (any source counts as activity)", () => {
    const clock = new Map([
      ["org-1", { lastEmailSentAt: daysAgo(30), lastReplyReceivedAt: daysAgo(2) }],
    ]);
    assert.deepEqual(followUpRecommendations([candidate()], clock, DEFAULT_FOLLOW_UP_THRESHOLDS, NOW), []);
  });

  it("a manual status change alone restarts the silence (audited transition counts)", () => {
    const clock = new Map([["org-1", { lastStatusChangeAt: daysAgo(8) }]]);
    const recs = followUpRecommendations(
      [candidate({ outreach_status: "no_response" })],
      clock,
      DEFAULT_FOLLOW_UP_THRESHOLDS,
      NOW,
    );
    assert.equal(recs.length, 1);
    assert.equal(recs[0].statusLabel, "No response");
  });

  it("sorts urgent above due, longest silence within each level (AC2 distinction)", () => {
    const candidates = [
      candidate({ id: "a", legal_name: "Due Client" }),
      candidate({ id: "b", legal_name: "Urgent Client" }),
      candidate({ id: "c", legal_name: "Urgent Later" }),
    ];
    const clocks = new Map([
      ["a", { lastEmailSentAt: daysAgo(8) }],
      ["b", { lastEmailSentAt: daysAgo(30) }],
      ["c", { lastEmailSentAt: daysAgo(15) }],
    ]);
    const order = followUpRecommendations(candidates, clocks, DEFAULT_FOLLOW_UP_THRESHOLDS, NOW).map(
      (r) => r.organisationId,
    );
    assert.deepEqual(order, ["b", "c", "a"]);
  });

  it("defaults match the AC's 7/14-day wording", () => {
    assert.deepEqual(DEFAULT_FOLLOW_UP_THRESHOLDS, { first: 7, second: 14 });
  });
});
