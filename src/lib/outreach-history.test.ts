import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeSendStatus,
  splitOutreachHistory,
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
