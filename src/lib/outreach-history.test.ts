import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeSendStatus,
  describeStatusFilter,
  buildEmailThread,
  filterOutreachHistory,
  splitOutreachHistory,
  STATUS_FILTERS,
  type OutreachMessageRow,
} from "./outreach-history.ts";

function message(overrides: Partial<OutreachMessageRow> = {}): OutreachMessageRow {
  return {
    id: "msg-1",
    subject: "Following up on our chat",
    body: "Hi there, following up on our call last week...",
    send_status: "sent",
    sent_at: "2026-08-01T09:00:00Z",
    scheduled_at: null,
    created_at: "2026-07-30T09:00:00Z",
    ...overrides,
  };
}

describe("splitOutreachHistory", () => {
  it("separates sent messages from drafts, scheduled, and failed ones", () => {
    const rows = [
      message({ id: "sent-1", send_status: "sent" }),
      message({ id: "draft-1", send_status: "draft", sent_at: null }),
      message({ id: "scheduled-1", send_status: "scheduled", sent_at: null }),
      message({ id: "failed-1", send_status: "failed", sent_at: null }),
    ];

    const history = splitOutreachHistory(rows);

    assert.deepEqual(history.sent.map((m) => m.id), ["sent-1"]);
    assert.deepEqual(
      history.notSent.map((m) => m.id).sort(),
      ["draft-1", "failed-1", "scheduled-1"],
    );
  });

  it("orders sent messages by when they actually went out, newest first", () => {
    const rows = [
      message({ id: "old", sent_at: "2026-07-01T00:00:00Z" }),
      message({ id: "new", sent_at: "2026-08-01T00:00:00Z" }),
      message({ id: "mid", sent_at: "2026-07-15T00:00:00Z" }),
    ];

    const history = splitOutreachHistory(rows);

    assert.deepEqual(history.sent.map((m) => m.id), ["new", "mid", "old"]);
  });

  it("orders not-sent messages by creation time, newest first, since they have no sent_at", () => {
    const rows = [
      message({
        id: "old-draft",
        send_status: "draft",
        sent_at: null,
        created_at: "2026-07-01T00:00:00Z",
      }),
      message({
        id: "new-draft",
        send_status: "draft",
        sent_at: null,
        created_at: "2026-08-01T00:00:00Z",
      }),
    ];

    const history = splitOutreachHistory(rows);

    assert.deepEqual(history.notSent.map((m) => m.id), ["new-draft", "old-draft"]);
  });

  it("returns empty lists for a client with no outreach at all", () => {
    assert.deepEqual(splitOutreachHistory([]), { sent: [], notSent: [] });
  });

  it("never mixes a draft into the sent list, even if it sorts first by date (AC3)", () => {
    // Guards the exact bug AC3 exists to prevent: a draft created after the
    // last real send must never appear to be "sent" just because it is newer.
    const rows = [
      message({ id: "old-sent", sent_at: "2026-07-01T00:00:00Z" }),
      message({
        id: "new-draft",
        send_status: "draft",
        sent_at: null,
        created_at: "2026-08-01T00:00:00Z",
      }),
    ];

    const history = splitOutreachHistory(rows);

    assert.deepEqual(history.sent.map((m) => m.id), ["old-sent"]);
    assert.deepEqual(history.notSent.map((m) => m.id), ["new-draft"]);
  });
});

describe("buildEmailThread (F134)", () => {
  it("merges original emails and replies in chronological order", () => {
    const sent = [
      message({ id: "email-2", subject: "Follow-up", body: "Any thoughts?", sent_at: "2026-08-03T09:00:00Z" }),
      message({ id: "email-1", subject: "Introduction", body: "Hello", sent_at: "2026-08-01T09:00:00Z" }),
    ];
    const thread = buildEmailThread(sent, [
      { id: "reply-2", outreach_message_id: "email-2", reply_body: "Let's talk.", received_at: "2026-08-04T09:00:00Z" },
      { id: "reply-1", outreach_message_id: "email-1", reply_body: "Thanks.", received_at: "2026-08-02T09:00:00Z" },
    ]);

    assert.deepEqual(thread.map((entry) => entry.id), ["email-1", "reply-1", "email-2", "reply-2"]);
    assert.deepEqual(thread.map((entry) => entry.kind), ["outgoing", "incoming", "outgoing", "incoming"]);
  });

  it("supports several back-and-forth messages without dropping older entries", () => {
    const thread = buildEmailThread(
      [message({ id: "email-1" }), message({ id: "email-2", sent_at: "2026-08-03T09:00:00Z" })],
      [
        { id: "reply-1", outreach_message_id: "email-1", reply_body: "First reply", received_at: "2026-08-02T09:00:00Z" },
        { id: "reply-2", outreach_message_id: "email-2", reply_body: "Second reply", received_at: "2026-08-04T09:00:00Z" },
      ],
    );

    assert.equal(thread.length, 4);
    assert.deepEqual(thread.map((entry) => entry.body), [
      "Hi there, following up on our call last week...",
      "First reply",
      "Hi there, following up on our call last week...",
      "Second reply",
    ]);
  });

  it("keeps an unmatched-to-message reply visible with no invented subject", () => {
    const thread = buildEmailThread([], [
      { id: "reply-orphan", outreach_message_id: null, reply_body: "Still here", received_at: "2026-08-02T09:00:00Z" },
    ]);

    assert.equal(thread[0]?.subject, null);
    assert.equal(thread[0]?.body, "Still here");
  });

  it("returns a clear empty model when there is no conversation", () => {
    assert.deepEqual(buildEmailThread([], []), []);
  });
});

describe("describeSendStatus", () => {
  it("labels each not-yet-sent status distinctly", () => {
    assert.equal(describeSendStatus("draft"), "Draft");
    assert.equal(describeSendStatus("scheduled"), "Scheduled");
    assert.equal(describeSendStatus("failed"), "Failed to send");
  });

  it("labels a delivered message as Sent", () => {
    assert.equal(describeSendStatus("sent"), "Sent");
  });
});

describe("filterOutreachHistory (F130 AC3)", () => {
  const rows = [
    message({ id: "sent-1", send_status: "sent" }),
    message({ id: "sent-2", send_status: "sent", sent_at: "2026-07-01T09:00:00Z" }),
    message({ id: "draft-1", send_status: "draft", sent_at: null }),
    message({ id: "scheduled-1", send_status: "scheduled", sent_at: null }),
    message({ id: "failed-1", send_status: "failed", sent_at: null }),
  ];
  const history = splitOutreachHistory(rows);

  it("returns the full history unchanged for the all filter", () => {
    const filtered = filterOutreachHistory(history, "all");
    assert.deepEqual(filtered, history);
  });

  it("narrows both halves to exactly one status", () => {
    for (const status of ["draft", "scheduled", "failed"] as const) {
      const filtered = filterOutreachHistory(history, status);
      assert.deepEqual(
        filtered.sent.map((m) => m.id),
        [],
        `${status} must never surface a sent row`,
      );
      assert.deepEqual(filtered.notSent.map((m) => m.id), [`${status}-1`]);
    }

    const sent = filterOutreachHistory(history, "sent");
    assert.deepEqual(sent.sent.map((m) => m.id).sort(), ["sent-1", "sent-2"]);
    assert.deepEqual(sent.notSent, []);
  });

  it("never lets a filter re-mix a draft into the sent list", () => {
    // Guards the same AC3 bug splitOutreachHistory guards, but through the
    // filter: a wrong implementation could filter raw rows instead of the
    // already-split halves.
    const filtered = filterOutreachHistory(history, "failed");
    assert.ok(filtered.sent.every((m) => m.send_status === "sent"));
    assert.ok(filtered.notSent.every((m) => m.send_status === "failed"));
  });

  it("offers every status plus the unfiltered view in the UI's filter list", () => {
    assert.deepEqual(STATUS_FILTERS, ["all", "draft", "scheduled", "sent", "failed"]);
    assert.equal(describeStatusFilter("all"), "All");
    assert.equal(describeStatusFilter("failed"), "Failed to send");
  });

  it("keeps the original history untouched (view state, not data state)", () => {
    filterOutreachHistory(history, "draft");
    assert.equal(history.sent.length, 2);
    assert.equal(history.notSent.length, 3);
  });
});
