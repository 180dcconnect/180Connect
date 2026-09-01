import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildConversation,
  buildInboxThreads,
  isRecentReply,
  REPLY_INTENTS,
  snippetFrom,
  threadStatus,
  type InboxMessageRow,
  type InboxReplyRow,
} from "./outreach-inbox.ts";

const NOW = new Date("2026-08-31T12:00:00Z");

function message(overrides: Partial<InboxMessageRow> = {}): InboxMessageRow {
  return {
    id: overrides.id ?? "msg-1",
    subject: overrides.subject ?? "Partnership with 180DC Sheffield",
    send_status: overrides.send_status ?? "sent",
    sent_at: overrides.sent_at ?? "2026-08-30T10:00:00Z",
    organisation_id: overrides.organisation_id ?? "org-1",
    sender: overrides.sender ?? { full_name: "Ada Lovelace" },
  };
}

function reply(overrides: Partial<InboxReplyRow> = {}): InboxReplyRow {
  return {
    id: overrides.id ?? "rep-1",
    reply_body: overrides.reply_body ?? "Thanks — happy to chat next week.",
    received_at: overrides.received_at ?? "2026-08-31T09:00:00Z",
    organisation_id: overrides.organisation_id ?? "org-1",
    intent: overrides.intent ?? "interested",
  };
}

const ORG_NAMES = new Map([
  ["org-1", "Oxfam GB"],
  ["org-2", "Shelter"],
]);

describe("snippetFrom", () => {
  it("takes the first non-empty line and collapses whitespace", () => {
    assert.equal(snippetFrom("Hello there\n\nsecond line"), "Hello there");
    assert.equal(snippetFrom("  spaced   out  "), "spaced out");
  });

  it("returns empty for null/blank", () => {
    assert.equal(snippetFrom(null), "");
    assert.equal(snippetFrom("   \n  "), "");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "x".repeat(300);
    const out = snippetFrom(long);
    assert.equal(out.length, 120);
    assert.ok(out.endsWith("…"));
  });
});

describe("threadStatus", () => {
  it("replied when the newest event is a reply", () => {
    assert.equal(threadStatus([{ type: "reply_received" }, { type: "email_sent" }]), "replied");
  });

  it("awaiting when a follow-up was sent after a reply", () => {
    // newest first: email_sent at [0], reply earlier
    assert.equal(threadStatus([{ type: "email_sent" }, { type: "reply_received" }]), "awaiting");
    const events = [{ type: "email_sent" as const }, { type: "reply_received" as const }];
    events.reverse(); // reply newest → replied
    assert.equal(threadStatus(events), "replied");
  });

  it("sent when only outreach exists", () => {
    assert.equal(threadStatus([{ type: "email_sent" }]), "sent");
    assert.equal(threadStatus([]), "sent");
  });
});

describe("isRecentReply", () => {
  it("true within 48h", () => {
    assert.equal(isRecentReply("2026-08-30T12:00:00Z", NOW), true);
  });

  it("false beyond 48h or for invalid timestamps", () => {
    assert.equal(isRecentReply("2026-08-28T11:00:00Z", NOW), false);
    assert.equal(isRecentReply("not-a-date", NOW), false);
  });
});

describe("buildInboxThreads", () => {
  it("groups messages and replies per organisation, newest first", () => {
    const threads = buildInboxThreads(
      [
        message({ id: "m1", organisation_id: "org-1", sent_at: "2026-08-30T10:00:00Z" }),
        message({ id: "m2", organisation_id: "org-2", sent_at: "2026-08-29T10:00:00Z" }),
      ],
      [reply({ id: "r1", organisation_id: "org-2", received_at: "2026-08-31T09:00:00Z" })],
      ORG_NAMES,
      NOW,
    );

    assert.equal(threads.length, 2);
    // org-2's reply (today) is newer than org-1's send (yesterday)
    assert.equal(threads[0].orgId, "org-2");
    assert.equal(threads[0].status, "replied");
    assert.equal(threads[0].lastEventLabel, "Reply received");
    assert.equal(threads[1].orgId, "org-1");
    assert.equal(threads[1].status, "sent");
  });

  it("drops rows whose organisation has no name (suppressed/deleted)", () => {
    const threads = buildInboxThreads(
      [message({ organisation_id: "org-gone" })],
      [],
      ORG_NAMES,
      NOW,
    );
    assert.equal(threads.length, 0);
  });

  it("ignores drafts and scheduled messages — only sent ones are events", () => {
    const threads = buildInboxThreads(
      [
        message({ send_status: "draft" }),
        message({ send_status: "scheduled", sent_at: null }),
        message({ id: "m-sent" }),
      ],
      [],
      ORG_NAMES,
      NOW,
    );
    assert.equal(threads.length, 1);
    assert.equal(threads[0].messageCount, 1);
  });

  it("counts messages and replies and keeps the latest reply intent", () => {
    const threads = buildInboxThreads(
      [message({ id: "m1" }), message({ id: "m2", sent_at: "2026-08-28T10:00:00Z" })],
      [
        reply({ id: "r-old", received_at: "2026-08-29T09:00:00Z", intent: "more_info" }),
        reply({ id: "r-new", received_at: "2026-08-31T09:00:00Z", intent: "interested" }),
      ],
      ORG_NAMES,
      NOW,
    );
    assert.equal(threads.length, 1);
    assert.equal(threads[0].messageCount, 4);
    assert.equal(threads[0].replyIntent, "interested");
    assert.ok(REPLY_INTENTS.includes(threads[0].replyIntent as never));
  });

  it("marks awaiting when the newest event is a send but a reply exists", () => {
    const threads = buildInboxThreads(
      [message({ id: "m-followup", sent_at: "2026-08-31T10:00:00Z" })],
      [reply({ id: "r1", received_at: "2026-08-30T09:00:00Z" })],
      ORG_NAMES,
      NOW,
    );
    assert.equal(threads.length, 1);
    assert.equal(threads[0].status, "awaiting");
    assert.equal(threads[0].lastEventLabel, "Email sent");
  });

  it("returns an empty list for empty input", () => {
    assert.deepEqual(buildInboxThreads([], [], ORG_NAMES, NOW), []);
  });

  it("sorts deterministically on equal timestamps", () => {
    const threads = buildInboxThreads(
      [
        message({ id: "a", organisation_id: "org-2", sent_at: "2026-08-30T10:00:00Z" }),
        message({ id: "b", organisation_id: "org-1", sent_at: "2026-08-30T10:00:00Z" }),
      ],
      [],
      ORG_NAMES,
      NOW,
    );
    assert.equal(threads[0].orgId, "org-1");
    assert.equal(threads[1].orgId, "org-2");
  });
});

describe("buildConversation", () => {
  // The shared `message` factory builds an InboxMessageRow, which has no body —
  // only the conversation view reads one, so it travels as a widening here.
  function withBody(
    body: string | null,
    overrides: Partial<InboxMessageRow> = {},
  ): InboxMessageRow & { body: string | null } {
    return { ...message(overrides), body };
  }

  it("interleaves sends and replies oldest first", () => {
    const entries = buildConversation(
      [
        withBody("Opening email", { id: "m1", sent_at: "2026-08-24T10:00:00Z" }),
        withBody("Follow-up", { id: "m2", sent_at: "2026-08-27T14:00:00Z" }),
      ],
      [reply({ id: "r1", reply_body: "Tell me more", received_at: "2026-08-26T09:00:00Z" })],
      "org-1",
      ORG_NAMES,
    );

    assert.deepEqual(
      entries.map((entry) => [entry.type, entry.body]),
      [
        ["email_sent", "Opening email"],
        ["reply_received", "Tell me more"],
        ["email_sent", "Follow-up"],
      ],
    );
  });

  it("carries the subject on sends and leaves it null on replies", () => {
    const entries = buildConversation(
      [withBody("Hello", { id: "m1", subject: "Introduction" })],
      [reply({ id: "r1" })],
      "org-1",
      ORG_NAMES,
    );
    const bySubject = new Map(entries.map((entry) => [entry.type, entry.subject]));
    assert.equal(bySubject.get("email_sent"), "Introduction");
    assert.equal(bySubject.get("reply_received"), null);
  });

  it("ignores rows belonging to another organisation", () => {
    const entries = buildConversation(
      [
        withBody("Ours", { id: "m1", organisation_id: "org-1" }),
        withBody("Someone else's", { id: "m2", organisation_id: "org-2" }),
      ],
      [reply({ id: "r1", organisation_id: "org-2" })],
      "org-1",
      ORG_NAMES,
    );
    assert.deepEqual(entries.map((entry) => entry.body), ["Ours"]);
  });

  it("drops drafts and scheduled messages, which are not events yet", () => {
    const entries = buildConversation(
      [
        withBody("A draft", { id: "m1", send_status: "draft", sent_at: null }),
        withBody("Queued", { id: "m2", send_status: "scheduled", sent_at: null }),
        withBody("Actually sent", { id: "m3", send_status: "sent" }),
      ],
      [],
      "org-1",
      ORG_NAMES,
    );
    assert.deepEqual(entries.map((entry) => entry.body), ["Actually sent"]);
  });

  it("returns nothing when the organisation is not in the visible set", () => {
    assert.deepEqual(
      buildConversation([message({ organisation_id: "org-9" })], [], "org-9", ORG_NAMES),
      [],
    );
  });

  it("renders a missing body as an empty string rather than undefined", () => {
    const entries = buildConversation(
      [withBody(null, { id: "m1" })],
      [],
      "org-1",
      ORG_NAMES,
    );
    assert.equal(entries[0].body, "");
  });
});
