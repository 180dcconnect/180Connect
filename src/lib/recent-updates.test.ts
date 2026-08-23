import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNKNOWN_ACTOR } from "./timeline.ts";
import {
  buildRecentUpdates,
  recentUpdatesCutoff,
  RECENT_UPDATES_LIMIT,
  RECENT_UPDATES_WINDOW_DAYS,
  type RecentAuditRow,
  type RecentNoteRow,
  type RecentOutreachMessageRow,
  type RecentReplyEventRow,
} from "./recent-updates.ts";

const ORG_A = "org-a";
const ORG_B = "org-b";
const ORG_SUPPRESSED = "org-suppressed";
const CAM_A = "cam-a";
const CAM_B = "cam-b";

/** A fixed "now" so window math is deterministic: 15 Aug 2026, noon UTC. */
const NOW = new Date("2026-08-15T12:00:00Z");

const ORG_NAMES = new Map<string, string>([
  [ORG_A, "Oxford Homeless Project"],
  [ORG_B, "Amnesty International"],
]);

const NAMES = new Map<string, string | null>([
  [CAM_A, "Ada Lovelace"],
  [CAM_B, "Bashir Bobboi"],
]);

function noteRow(overrides: Partial<RecentNoteRow> = {}): RecentNoteRow {
  return {
    id: "note-1",
    content: "Spoke with the treasurer.",
    created_at: "2026-08-14T09:00:00Z",
    updated_at: null,
    organisation_id: ORG_A,
    author: { full_name: "Ada Lovelace" },
    ...overrides,
  };
}

function messageRow(overrides: Partial<RecentOutreachMessageRow> = {}): RecentOutreachMessageRow {
  return {
    id: "msg-1",
    subject: "Following up",
    send_status: "sent" as const,
    sent_at: "2026-08-13T09:00:00Z",
    organisation_id: ORG_A,
    sender: { full_name: "Ada Lovelace" },
    ...overrides,
  };
}

function replyRow(overrides: Partial<RecentReplyEventRow> = {}): RecentReplyEventRow {
  return {
    id: "reply-1",
    reply_body: "Thanks, we'll get back to you next week.",
    received_at: "2026-08-14T15:00:00Z",
    organisation_id: ORG_B,
    ...overrides,
  };
}

function auditRow(overrides: Partial<RecentAuditRow> = {}): RecentAuditRow {
  return {
    id: "audit-1",
    actor_user_id: CAM_B,
    action: "status_changed",
    target_id: ORG_B,
    detail: { from: "not_contacted", to: "initial_outreach_sent" },
    created_at: "2026-08-12T09:00:00Z",
    ...overrides,
  };
}

function emptySources() {
  return { notes: [], outreachMessages: [], replyEvents: [], auditRows: [] };
}

describe("recentUpdatesCutoff", () => {
  it("is exactly RECENT_UPDATES_WINDOW_DAYS days before now", () => {
    assert.deepEqual(
      recentUpdatesCutoff(NOW),
      new Date(NOW.getTime() - RECENT_UPDATES_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    );
  });

  it("serialises to an ISO string that is safe inside PostgREST filter grammar", () => {
    // Callers pass this straight into .gte()/or= filters, where postgrest-js
    // interpolates the value raw — a Date's toString ("Sat Aug 08 … (Coordinated
    // Universal Time)") would break both. Commas/parens are the or=() grammar
    // delimiters; there must be none.
    const iso = recentUpdatesCutoff(NOW).toISOString();
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(!/[(),]/.test(iso));
  });
});

describe("buildRecentUpdates — normal data (F028 testing notes)", () => {
  it("merges all six event kinds into one newest-first feed", () => {
    const feed = buildRecentUpdates(
      {
        notes: [
          noteRow({ id: "note-1", created_at: "2026-08-10T09:00:00Z" }),
          noteRow({
            id: "note-2",
            created_at: "2026-08-11T09:00:00Z",
            updated_at: "2026-08-14T09:00:00Z",
          }),
        ],
        outreachMessages: [messageRow({ sent_at: "2026-08-13T09:00:00Z" })],
        replyEvents: [replyRow({ received_at: "2026-08-15T08:00:00Z" })],
        auditRows: [
          auditRow({ created_at: "2026-08-12T09:00:00Z" }),
          auditRow({
            id: "audit-2",
            action: "ownership_reassigned",
            created_at: "2026-08-13T16:00:00Z",
            detail: { from: CAM_A, to: CAM_B, reason: "Handover" },
          }),
        ],
      },
      ORG_NAMES,
      NAMES,
      NOW,
    );

    assert.deepEqual(
      feed.map((entry) => entry.id),
      ["reply-reply-1", "note-edited-note-2", "ownership-audit-2", "email-msg-1", "status-audit-1", "note-added-note-2", "note-added-note-1"],
    );
  });

  it("names the client on every entry, with a link (AC2)", () => {
    const feed = buildRecentUpdates(
      { ...emptySources(), replyEvents: [replyRow()] },
      ORG_NAMES,
      NAMES,
      NOW,
    );

    assert.equal(feed.length, 1);
    assert.equal(feed[0].orgName, "Amnesty International");
    assert.equal(feed[0].href, `/clients/${ORG_B}`);
    // The summary says what changed without clicking through.
    assert.ok(feed[0].summary.includes("Thanks"));
  });

  it("labels every entry from the finite F076 event set (AC1)", () => {
    const feed = buildRecentUpdates(
      {
        notes: [noteRow({ updated_at: "2026-08-14T10:00:00Z" })],
        outreachMessages: [messageRow()],
        replyEvents: [replyRow()],
        auditRows: [auditRow()],
      },
      ORG_NAMES,
      NAMES,
      NOW,
    );

    for (const entry of feed) {
      assert.match(entry.eventLabel, /^(Email sent|Reply received|Note added|Note edited|Status changed|Ownership changed)$/);
    }
  });

  it("drops entries for organisations missing from the visible set (e.g. suppressed)", () => {
    const feed = buildRecentUpdates(
      {
        ...emptySources(),
        notes: [noteRow({ organisation_id: ORG_SUPPRESSED })],
        replyEvents: [replyRow()],
      },
      ORG_NAMES,
      NAMES,
      NOW,
    );

    assert.deepEqual(
      feed.map((entry) => entry.orgId),
      [ORG_B],
    );
  });

  it("resolves audit actors and handover targets by name, with the former-member fallback", () => {
    const feed = buildRecentUpdates(
      {
        ...emptySources(),
        auditRows: [
          auditRow({
            actor_user_id: "gone-user",
            action: "ownership_reassigned",
            detail: { from: "gone-user", to: null, reason: "Left the team" },
          }),
        ],
      },
      ORG_NAMES,
      NAMES,
      NOW,
    );

    assert.equal(feed.length, 1);
    assert.equal(feed[0].actorName, UNKNOWN_ACTOR);
    assert.ok(feed[0].summary.includes(UNKNOWN_ACTOR));
    assert.ok(feed[0].summary.includes("Unassigned"));
  });
});

describe("buildRecentUpdates — window and cap (F028 AC3)", () => {
  it("drops entries older than the window but keeps an old note edited inside it", () => {
    const feed = buildRecentUpdates(
      {
        ...emptySources(),
        notes: [
          noteRow({ id: "old-note", created_at: "2026-07-01T09:00:00Z" }),
          noteRow({
            id: "edited-old-note",
            created_at: "2026-07-01T09:00:00Z",
            updated_at: "2026-08-14T09:00:00Z",
          }),
        ],
        outreachMessages: [messageRow({ sent_at: "2026-07-20T09:00:00Z" })],
        auditRows: [auditRow({ created_at: "2026-06-01T09:00:00Z" })],
      },
      ORG_NAMES,
      NAMES,
      NOW,
    );

    // Only the edit made inside the window survives; the original creations
    // and the old send/status change are outside the 14-day cutoff.
    assert.deepEqual(
      feed.map((entry) => entry.id),
      ["note-edited-edited-old-note"],
    );
  });

  it("keeps only an entry exactly on the cutoff boundary or newer", () => {
    const onCutoff = new Date(recentUpdatesCutoff(NOW).getTime());
    const justBefore = new Date(onCutoff.getTime() - 60_000);

    const feed = buildRecentUpdates(
      {
        ...emptySources(),
        replyEvents: [
          replyRow({ id: "on-cutoff", received_at: onCutoff.toISOString() }),
          replyRow({ id: "just-before", received_at: justBefore.toISOString() }),
        ],
      },
      ORG_NAMES,
      NAMES,
      NOW,
    );

    assert.deepEqual(
      feed.map((entry) => entry.id),
      ["reply-on-cutoff"],
    );
  });

  it("caps the merged feed at RECENT_UPDATES_LIMIT items, newest first", () => {
    const replies: RecentReplyEventRow[] = Array.from({ length: RECENT_UPDATES_LIMIT + 5 }, (_, i) =>
      replyRow({
        id: `reply-${i}`,
        received_at: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString(),
      }),
    );

    const feed = buildRecentUpdates(
      { ...emptySources(), replyEvents: replies },
      ORG_NAMES,
      NAMES,
      NOW,
    );

    assert.equal(feed.length, RECENT_UPDATES_LIMIT);
    assert.equal(feed[0].id, "reply-reply-0");
  });
});

describe("buildRecentUpdates — no data (F028 testing notes)", () => {
  it("returns an empty feed from empty sources", () => {
    const feed = buildRecentUpdates(emptySources(), ORG_NAMES, NAMES, NOW);
    assert.deepEqual(feed, []);
  });

  it("returns an empty feed when nothing in any source is inside the window", () => {
    const feed = buildRecentUpdates(
      {
        notes: [noteRow({ created_at: "2025-01-01T09:00:00Z" })],
        outreachMessages: [],
        replyEvents: [],
        auditRows: [],
      },
      ORG_NAMES,
      NAMES,
      NOW,
    );
    assert.deepEqual(feed, []);
  });
});
