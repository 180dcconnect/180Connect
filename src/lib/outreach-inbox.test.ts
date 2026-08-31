import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
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
