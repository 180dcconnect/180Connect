import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildRelationshipStats,
  formatDayCount,
  recentHandovers,
} from "./inbox-thread-context.ts";
import type { ConversationEntry } from "./outreach-inbox.ts";

const NOW = new Date("2026-09-01T12:00:00Z");

function sent(timestamp: string, id = `sent-${timestamp}`): ConversationEntry {
  return {
    id,
    type: "email_sent",
    timestamp,
    actorName: "Ada Lovelace",
    subject: "Introduction: 180DC Sheffield",
    body: "Hello,\n\nWe would love to explore a project together.",
    intent: null,
  };
}

function received(timestamp: string, id = `reply-${timestamp}`): ConversationEntry {
  return {
    id,
    type: "reply_received",
    timestamp,
    actorName: "The client",
    subject: null,
    body: "Thanks for reaching out.",
    intent: "more_info",
  };
}

describe("buildRelationshipStats", () => {
  it("returns null for an empty thread", () => {
    assert.equal(buildRelationshipStats([], NOW), null);
  });

  it("counts each side and dates the ends of the conversation", () => {
    const stats = buildRelationshipStats(
      [
        sent("2026-08-24T10:00:00Z"),
        received("2026-08-26T09:00:00Z"),
        sent("2026-08-27T14:00:00Z"),
        received("2026-08-31T09:00:00Z"),
      ],
      NOW,
    );

    assert.ok(stats);
    assert.equal(stats.firstContactAt, "2026-08-24T10:00:00Z");
    assert.equal(stats.lastActivityAt, "2026-08-31T09:00:00Z");
    assert.equal(stats.sentCount, 2);
    assert.equal(stats.replyCount, 2);
    assert.equal(stats.daysSinceFirstContact, 8);
    assert.equal(stats.daysSinceLastActivity, 1);
  });

  it("reads the newest entry from the end of the oldest-first array", () => {
    const stats = buildRelationshipStats([sent("2026-08-24T10:00:00Z"), received("2026-08-30T10:00:00Z")], NOW);
    assert.equal(stats?.lastActivityAt, "2026-08-30T10:00:00Z");
  });

  it("sets awaitingSince when our latest email follows a client reply", () => {
    const stats = buildRelationshipStats(
      [sent("2026-08-24T10:00:00Z"), received("2026-08-26T09:00:00Z"), sent("2026-08-27T14:00:00Z")],
      NOW,
    );
    assert.equal(stats?.awaitingSince, "2026-08-27T14:00:00Z");
  });

  it("leaves awaitingSince null when the client replied last", () => {
    const stats = buildRelationshipStats(
      [sent("2026-08-24T10:00:00Z"), received("2026-08-26T09:00:00Z")],
      NOW,
    );
    assert.equal(stats?.awaitingSince, null);
  });

  it("leaves awaitingSince null on a first email nobody has answered", () => {
    // "Awaiting" is a wait we are owed an answer on, not the ordinary gap
    // after an opening email — same distinction threadStatus draws.
    const stats = buildRelationshipStats([sent("2026-08-24T10:00:00Z")], NOW);
    assert.equal(stats?.awaitingSince, null);
    assert.equal(stats?.replyCount, 0);
  });

  it("never reports negative days for a future timestamp", () => {
    const stats = buildRelationshipStats([sent("2026-09-10T10:00:00Z")], NOW);
    assert.equal(stats?.daysSinceFirstContact, 0);
    assert.equal(stats?.daysSinceLastActivity, 0);
  });

  it("leaves firstContactAt null for a thread with no sent email", () => {
    const stats = buildRelationshipStats([received("2026-08-26T09:00:00Z")], NOW);
    assert.equal(stats?.firstContactAt, null);
    assert.equal(stats?.daysSinceFirstContact, null);
    assert.equal(stats?.sentCount, 0);
  });
});

describe("formatDayCount", () => {
  it("words the small numbers rather than showing a bare 0 or 1", () => {
    assert.equal(formatDayCount(0), "today");
    assert.equal(formatDayCount(-3), "today");
    assert.equal(formatDayCount(1), "1 day");
    assert.equal(formatDayCount(8), "8 days");
  });
});

describe("recentHandovers", () => {
  it("orders newest first and caps the list", () => {
    const entries = [
      { id: "a", timestamp: "2026-01-01T00:00:00Z" },
      { id: "b", timestamp: "2026-06-01T00:00:00Z" },
      { id: "c", timestamp: "2026-03-01T00:00:00Z" },
      { id: "d", timestamp: "2026-08-01T00:00:00Z" },
    ];
    assert.deepEqual(
      recentHandovers(entries, 2).map((entry) => entry.id),
      ["d", "b"],
    );
  });

  it("does not mutate the array it was given", () => {
    const entries = [
      { id: "a", timestamp: "2026-01-01T00:00:00Z" },
      { id: "b", timestamp: "2026-06-01T00:00:00Z" },
    ];
    recentHandovers(entries);
    assert.deepEqual(entries.map((entry) => entry.id), ["a", "b"]);
  });
});
