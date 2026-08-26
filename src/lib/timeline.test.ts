import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatOutreachStatus } from "./organisation-format.ts";
import {
  TIMELINE_EVENT_LABEL,
  TIMELINE_EVENT_STYLE,
  UNKNOWN_ACTOR,
  buildEditSuggestionEntry,
  buildEmailSentEntry,
  buildNoteEntries,
  buildOwnershipReassignedEntry,
  buildReplyReceivedEntry,
  buildStatusChangedEntry,
  buildTimeline,
  type AuditRow,
  type NoteRow,
  type OutreachMessageRow,
  type ReplyEventRow,
  type TimelineEventType,
} from "./timeline.ts";

const CAM_A = "cam-a";
const CAM_B = "cam-b";
const NAMES = new Map<string, string | null>([
  [CAM_A, "Ada Lovelace"],
  [CAM_B, "Bashir Bobboi"],
]);

const ALL_EVENT_TYPES: TimelineEventType[] = [
  "email_sent",
  "reply_received",
  "note_added",
  "note_edited",
  "status_changed",
  "ownership_reassigned",
  "edit_applied",
  "edit_rejected",
];

function noteRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: "note-1",
    content: "Spoke with the treasurer.",
    created_at: "2026-08-01T09:00:00Z",
    updated_at: null,
    author: { full_name: "Ada Lovelace" },
    ...overrides,
  };
}

function messageRow(overrides: Partial<OutreachMessageRow> = {}): OutreachMessageRow {
  return {
    id: "msg-1",
    subject: "Following up",
    send_status: "sent",
    sent_at: "2026-08-02T09:00:00Z",
    sender: { full_name: "Ada Lovelace" },
    ...overrides,
  };
}

function replyRow(overrides: Partial<ReplyEventRow> = {}): ReplyEventRow {
  return {
    id: "reply-1",
    reply_body: "Thanks, we'll get back to you next week.",
    received_at: "2026-08-03T09:00:00Z",
    ...overrides,
  };
}

function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "audit-1",
    actor_user_id: CAM_A,
    action: "status_changed",
    detail: {},
    created_at: "2026-08-04T09:00:00Z",
    ...overrides,
  };
}

describe("TIMELINE_EVENT_LABEL and TIMELINE_EVENT_STYLE (F076 AC1)", () => {
  it("gives every event type both a label and a style, from the same finite set", () => {
    for (const type of ALL_EVENT_TYPES) {
      assert.ok(TIMELINE_EVENT_LABEL[type], `missing label for ${type}`);
      assert.ok(TIMELINE_EVENT_STYLE[type], `missing style for ${type}`);
    }
  });

  it("gives every event type a visually distinct tone+fill pairing (F076 AC2)", () => {
    const seen = new Set<string>();
    for (const type of ALL_EVENT_TYPES) {
      const style = TIMELINE_EVENT_STYLE[type];
      const key = `${style.tone}:${style.fill}`;
      assert.ok(!seen.has(key), `${type} shares its style with an earlier type (${key})`);
      seen.add(key);
    }
    assert.equal(seen.size, ALL_EVENT_TYPES.length);
  });
});

describe("buildNoteEntries", () => {
  it("produces one entry for a note that was never edited", () => {
    const entries = buildNoteEntries(noteRow());
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, "note_added");
    assert.equal(entries[0].timestamp, "2026-08-01T09:00:00Z");
  });

  it("produces a second entry at updated_at for an edited note", () => {
    const entries = buildNoteEntries(
      noteRow({ updated_at: "2026-08-05T09:00:00Z" }),
    );
    assert.equal(entries.length, 2);
    assert.equal(entries[0].type, "note_added");
    assert.equal(entries[1].type, "note_edited");
    assert.equal(entries[1].timestamp, "2026-08-05T09:00:00Z");
  });

  it("falls back to the former-team-member label for a deleted author (F257 AC5)", () => {
    const entries = buildNoteEntries(noteRow({ author: null }));
    assert.equal(entries[0].actorName, UNKNOWN_ACTOR);
  });

  it("attributes both entries to the original author, not silently omitted (F257 AC5)", () => {
    const entries = buildNoteEntries(
      noteRow({ author: { full_name: "Departed CAM" }, updated_at: "2026-08-05T00:00:00Z" }),
    );
    assert.equal(entries[0].actorName, "Departed CAM");
    assert.equal(entries[1].actorName, "Departed CAM");
  });
});

describe("buildEmailSentEntry", () => {
  it("builds an entry for a sent message", () => {
    const entry = buildEmailSentEntry(messageRow());
    assert.ok(entry);
    assert.equal(entry?.type, "email_sent");
    assert.equal(entry?.summary, "Following up");
  });

  it("returns null for a draft — not yet something that happened", () => {
    assert.equal(buildEmailSentEntry(messageRow({ send_status: "draft", sent_at: null })), null);
  });

  it("returns null for a scheduled-but-unsent message", () => {
    assert.equal(
      buildEmailSentEntry(messageRow({ send_status: "scheduled", sent_at: null })),
      null,
    );
  });

  it("returns null for a failed send", () => {
    assert.equal(buildEmailSentEntry(messageRow({ send_status: "failed", sent_at: null })), null);
  });
});

describe("buildReplyReceivedEntry", () => {
  it("attributes a reply to the client, not a team member", () => {
    const entry = buildReplyReceivedEntry(replyRow());
    assert.equal(entry.actorName, "The client");
    assert.equal(entry.type, "reply_received");
  });
});

describe("buildStatusChangedEntry", () => {
  it("formats the from/to statuses with the shared formatter", () => {
    const entry = buildStatusChangedEntry(
      auditRow({ detail: { from: "not_contacted", to: "contacted" } }),
      NAMES,
    );
    assert.equal(
      entry.summary,
      `Status changed from ${formatOutreachStatus("not_contacted")} to ${formatOutreachStatus("contacted")}.`,
    );
    assert.equal(entry.actorName, "Ada Lovelace");
  });

  it("renders the F147 auto-transition (first outreach email sent) in plain labels", () => {
    const entry = buildStatusChangedEntry(
      auditRow({ detail: { from: "not_contacted", to: "initial_outreach_sent" } }),
      NAMES,
    );
    assert.equal(entry.type, "status_changed");
    assert.equal(entry.summary, "Status changed from Not contacted to Initial outreach sent.");
  });

  it("renders the F148 transition (a later send) distinctly from the initial one (F147 AC2)", () => {
    const entry = buildStatusChangedEntry(
      auditRow({ detail: { from: "initial_outreach_sent", to: "follow_up_sent" } }),
      NAMES,
    );
    assert.equal(entry.summary, "Status changed from Initial outreach sent to Follow up sent.");
  });
});

describe("buildEditSuggestionEntry (#80/#81)", () => {
  it("renders an approval with the field label, new value and proposer", () => {
    const entry = buildEditSuggestionEntry(
      auditRow({
        action: "edit_suggestion_approved",
        actor_user_id: "admin-1",
        detail: {
          field: "city",
          from: null,
          to: "Leeds",
          requested_by: CAM_B,
        },
      }),
      NAMES,
    );
    assert.equal(entry.type, "edit_applied");
    assert.equal(entry.actorName, UNKNOWN_ACTOR);
    assert.match(entry.summary, /Applied a suggested edit to Town or city/);
    assert.match(entry.summary, /now "Leeds"/);
    assert.match(entry.summary, /proposed by Bashir Bobboi/);
  });

  it("renders a rejection as unchanged, carrying the admin's reason", () => {
    const entry = buildEditSuggestionEntry(
      auditRow({
        action: "edit_suggestion_rejected",
        detail: { field: "website", reason: "Registry shows a different URL" },
      }),
      NAMES,
    );
    assert.equal(entry.type, "edit_rejected");
    assert.match(entry.summary, /Declined a suggested edit to Website/);
    assert.match(entry.summary, /record is unchanged/);
    assert.match(entry.summary, /Reason: Registry shows a different URL/);
  });

  it("falls back safely on an unrecognised field key or missing detail", () => {
    const entry = buildEditSuggestionEntry(
      auditRow({ action: "edit_suggestion_approved", detail: {} }),
      NAMES,
    );
    assert.equal(entry.type, "edit_applied");
    assert.match(entry.summary, /a field/);
  });
});

describe("buildOwnershipReassignedEntry", () => {
  it("names the outgoing CAM, the incoming CAM and the reason (F257 AC5)", () => {
    const entry = buildOwnershipReassignedEntry(
      auditRow({
        action: "ownership_reassigned",
        actor_user_id: "admin-1",
        detail: { from: CAM_A, to: CAM_B, reason: "Offboarded" },
      }),
      NAMES,
    );
    assert.deepEqual(entry.handover, {
      fromName: "Ada Lovelace",
      toName: "Bashir Bobboi",
      reason: "Offboarded",
    });
  });

  it("shows 'Unassigned' rather than a former-member label when ownership was released", () => {
    const entry = buildOwnershipReassignedEntry(
      auditRow({ detail: { from: CAM_A, to: null, reason: "Offboarded, no replacement yet" } }),
      NAMES,
    );
    assert.equal(entry.handover?.toName, "Unassigned");
  });

  it("falls back to the former-team-member label for a from/to id no longer in the names map (F257 AC5)", () => {
    const entry = buildOwnershipReassignedEntry(
      auditRow({ detail: { from: "deleted-user", to: CAM_B, reason: "Offboarded" } }),
      NAMES,
    );
    assert.equal(entry.handover?.fromName, UNKNOWN_ACTOR);
  });

  it("shows a default reason rather than an empty string when none was given", () => {
    const entry = buildOwnershipReassignedEntry(
      auditRow({ detail: { from: CAM_A, to: CAM_B } }),
      NAMES,
    );
    assert.equal(entry.handover?.reason, "No reason given");
  });
});

describe("buildTimeline", () => {
  it("merges every source into one feed, newest first", () => {
    const timeline = buildTimeline(
      {
        notes: [noteRow({ id: "n1", created_at: "2026-08-01T00:00:00Z" })],
        outreachMessages: [messageRow({ id: "m1", sent_at: "2026-08-03T00:00:00Z" })],
        replyEvents: [replyRow({ id: "r1", received_at: "2026-08-02T00:00:00Z" })],
        auditRows: [
          auditRow({ id: "a1", action: "status_changed", created_at: "2026-08-04T00:00:00Z" }),
        ],
      },
      NAMES,
    );

    assert.deepEqual(
      timeline.map((entry) => entry.type),
      ["status_changed", "email_sent", "reply_received", "note_added"],
    );
  });

  it("drops an audit row whose action this timeline does not render, rather than showing it unlabelled (F076 AC3)", () => {
    const timeline = buildTimeline(
      {
        notes: [],
        outreachMessages: [],
        replyEvents: [],
        auditRows: [auditRow({ action: "role_changed" })],
      },
      NAMES,
    );
    assert.equal(timeline.length, 0);
  });

  it("gives every produced entry a type from the defined set — never an ad hoc string (F076 AC3)", () => {
    const timeline = buildTimeline(
      {
        notes: [noteRow({ updated_at: "2026-08-05T00:00:00Z" })],
        outreachMessages: [messageRow()],
        replyEvents: [replyRow()],
        auditRows: [
          auditRow({ action: "status_changed" }),
          auditRow({ id: "a2", action: "ownership_reassigned" }),
        ],
      },
      NAMES,
    );

    assert.ok(timeline.length > 0);
    for (const entry of timeline) {
      assert.ok(
        ALL_EVENT_TYPES.includes(entry.type),
        `${entry.id} has a type outside the defined set: ${entry.type}`,
      );
    }
  });

  it("returns an empty feed for a client with no activity at all", () => {
    const timeline = buildTimeline(
      { notes: [], outreachMessages: [], replyEvents: [], auditRows: [] },
      NAMES,
    );
    assert.deepEqual(timeline, []);
  });

  it("interleaves a note's edited entry among later events, not only under its original date", () => {
    const timeline = buildTimeline(
      {
        notes: [
          noteRow({
            id: "n1",
            created_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-05T00:00:00Z",
          }),
        ],
        outreachMessages: [messageRow({ id: "m1", sent_at: "2026-08-03T00:00:00Z" })],
        replyEvents: [],
        auditRows: [],
      },
      NAMES,
    );

    assert.deepEqual(
      timeline.map((entry) => entry.type),
      ["note_edited", "email_sent", "note_added"],
    );
  });
});
