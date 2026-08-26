import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_FOLLOW_UP_THRESHOLDS,
  FOLLOW_UP_TRIGGER_STATUSES,
} from "./follow-up-recommendations.ts";
import { stalledClients, type StallCandidate } from "./stall-detection.ts";

const NOW = new Date("2026-09-15T12:00:00Z");
const CAM_A = "11111111-1111-4111-8111-111111111111";
const CAM_B = "22222222-2222-4222-8222-222222222222";
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function candidate(overrides: Partial<StallCandidate> = {}): StallCandidate {
  return {
    id: "org-1",
    legal_name: "Alpha Charity",
    outreach_status: "follow_up_sent",
    owner_id: CAM_A,
    ...overrides,
  };
}

function activity(days: number | null) {
  if (days === null) return new Map<string, { lastEmailSentAt: string | null }>();
  return new Map([[candidate().id, { lastEmailSentAt: daysAgo(days) }]]);
}

describe("stalledClients — F183 stall rule", () => {
  it("only flags clients in trigger statuses", () => {
    for (const status of [...FOLLOW_UP_TRIGGER_STATUSES]) {
      const flags = stalledClients(
        [candidate({ outreach_status: status })],
        activity(20),
        new Map(),
        new Set(),
        NOW,
      );
      assert.equal(flags.length, 1, status);
    }
    for (const status of ["not_contacted", "responded", "converted", "soft_no"]) {
      assert.deepEqual(
        stalledClients([candidate({ outreach_status: status })], activity(20), new Map(), new Set(), NOW),
        [],
        status,
      );
    }
  });

  it("fires at the owner's second (urgent) threshold — boundary inclusive", () => {
    assert.deepEqual(
      stalledClients([candidate()], activity(13), new Map(), new Set(), NOW),
      [],
      "day 13 is below default second threshold 14",
    );
    const stalled = stalledClients([candidate()], activity(14), new Map(), new Set(), NOW);
    assert.equal(stalled.length, 1);
    assert.equal(stalled[0].daysWaiting, 14);
  });

  it("a client with an open action is not stalled even when very stale", () => {
    assert.deepEqual(
      stalledClients([candidate()], activity(40), new Map(), new Set(["org-1"]), NOW),
      [],
    );
  });

  it("a completed action does not suppress the flag — only status=open counts", () => {
    const withoutOpen = stalledClients([candidate()], activity(40), new Map(), new Set(), NOW);
    assert.equal(withoutOpen.length, 1);
  });

  it("uses per-owner thresholds — each CAM's second threshold governs their clients", () => {
    const thresholds = new Map([
      [CAM_A, { first: 14, second: 30 }],
      [CAM_B, { first: 7, second: 14 }],
    ]);
    // CAM_A's client at day 20 -> below 30 -> not stalled
    assert.deepEqual(
      stalledClients([candidate({ owner_id: CAM_A })], activity(20), thresholds, new Set(), NOW),
      [],
    );
    // CAM_B's client at same age -> above 14 -> stalled
    const stalled = stalledClients(
      [candidate({ id: "org-2", owner_id: CAM_B })],
      new Map([["org-2", { lastEmailSentAt: daysAgo(20) }]]),
      thresholds,
      new Set(),
      NOW,
    );
    assert.equal(stalled.length, 1);
  });

  it("falls back to defaults for owners without a preferences row and for unowned clients", () => {
    const unowned = stalledClients(
      [candidate({ id: "u1", owner_id: null })],
      new Map([["u1", { lastEmailSentAt: daysAgo(20) }]]),
      new Map(),
      new Set(),
      NOW,
    );
    assert.equal(unowned.length, 1, "unowned uses default second threshold 14");

    const unknownOwner = "33333333-3333-4333-8333-333333333333";
    const unknown = stalledClients(
      [candidate({ id: "u2", owner_id: unknownOwner })],
      new Map([["u2", { lastEmailSentAt: daysAgo(13) }]]),
      new Map([[CAM_A, { first: 7, second: 14 }]]),
      new Set(),
      NOW,
    );
    assert.deepEqual(unknown, [], "day 13 below default second threshold");
  });

  it("skips a trigger-status client with no measurable activity rather than guessing", () => {
    assert.deepEqual(stalledClients([candidate()], new Map(), new Map(), new Set(), NOW), []);
  });

  it("folds inverted thresholds so due/urgent ordering stays sane", () => {
    const inverted = new Map([[CAM_A, { first: 20, second: 10 }]]);
    // Normalised to 10..20, so second becomes 20; day 15 is between -> not stalled
    assert.deepEqual(stalledClients([candidate()], activity(15), inverted, new Set(), NOW), []);
    // Day 20 hits the normalised urgent boundary
    assert.equal(stalledClients([candidate()], activity(20), inverted, new Set(), NOW).length, 1);
  });

  it("sorts longest silence first, tie-break on organisationId", () => {
    const candidates = [
      candidate({ id: "b", legal_name: "B" }),
      candidate({ id: "a", legal_name: "A" }),
      candidate({ id: "c", legal_name: "C" }),
    ];
    const clocks = new Map([
      ["a", { lastEmailSentAt: daysAgo(30) }],
      ["b", { lastEmailSentAt: daysAgo(30) }],
      ["c", { lastEmailSentAt: daysAgo(20) }],
    ]);
    const order = stalledClients(candidates, clocks, new Map(), new Set(), NOW).map(
      (f) => f.organisationId,
    );
    assert.deepEqual(order, ["a", "b", "c"], "30-day ties broken by id, then 20 days");
  });

  it("handles empty input", () => {
    assert.deepEqual(stalledClients([], new Map(), new Map(), new Set(), NOW), []);
  });
});
