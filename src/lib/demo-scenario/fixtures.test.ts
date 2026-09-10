import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEMO_CAST_EMAILS,
  DEMO_ID_LIKE,
  DEMO_ID_PREFIX,
  DEMO_PIPELINE_COVERAGE,
  demoActions,
  demoAuditEntries,
  demoEditSuggestions,
  demoId,
  demoNotes,
  demoNotifications,
  demoOrgId,
  demoOrganisations,
  demoOutreachMessages,
  demoReplyEvents,
} from "./fixtures.ts";

/**
 * The scenario is data, so these are the properties a reader of the data cannot
 * check by eye: that nothing collides, that every id is inside the namespace
 * the clear deletes, that the storylines the runbook promises actually have
 * rows behind them, and that no fixture points at a client or a cast member
 * that does not exist.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("demoId", () => {
  it("mints a syntactically valid v4-shaped uuid", () => {
    assert.match(demoId(0x01, 0), UUID);
    assert.match(demoId(0xff, 0xffff), UUID);
  });

  it("puts every id inside the namespace the clear matches on", () => {
    assert.ok(demoId(0x03, 7).startsWith(DEMO_ID_PREFIX));
    assert.equal(DEMO_ID_LIKE, `${DEMO_ID_PREFIX}%`);
  });

  it("refuses a tag or index that would not fit its field", () => {
    assert.throws(() => demoId(-1, 0), RangeError);
    assert.throws(() => demoId(0x100, 0), RangeError);
    assert.throws(() => demoId(0x01, 0x10000), RangeError);
    assert.throws(() => demoId(1.5, 0), RangeError);
  });
});

describe("the scenario as a whole", () => {
  const everyRow = [
    ...demoOrganisations(),
    ...demoActions(),
    ...demoOutreachMessages(),
    ...demoReplyEvents(),
    ...demoEditSuggestions(),
    ...demoNotifications(),
    ...demoAuditEntries(),
    ...demoNotes(),
  ];

  it("mints every row into the demo namespace", () => {
    for (const row of everyRow) {
      assert.ok(
        row.id.startsWith(DEMO_ID_PREFIX),
        `${row.id} is outside the demo namespace, so the clear would leave it behind`,
      );
    }
  });

  it("never issues the same id twice", () => {
    const ids = everyRow.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("demo organisations", () => {
  const organisations = demoOrganisations();

  it("covers all ten pipeline statuses", () => {
    const present = new Set(organisations.map((org) => org.outreach_status));
    for (const status of DEMO_PIPELINE_COVERAGE) {
      assert.ok(present.has(status), `no demo client sits at ${status}`);
    }
  });

  it("spreads ownership across the cast so team-wide views have columns", () => {
    const owners = new Set(organisations.map((org) => org.owner_key));
    assert.ok(owners.size >= 3);
  });

  it("uses only example.org for mailboxes and sites", () => {
    for (const org of organisations) {
      assert.match(org.contact_email, /@[a-z0-9.-]*example\.org$/);
      assert.match(org.website, /^https:\/\/[a-z0-9.-]*example\.org$/);
    }
  });

  it("gives at least one client a long enough silence to read as stalled", () => {
    assert.ok(organisations.some((org) => org.quiet_days >= 21));
  });

  it("resolves a client by name and refuses an unknown one", () => {
    assert.equal(demoOrgId("Riverbank Youth Trust"), organisations[0].id);
    assert.throws(() => demoOrgId("No Such Trust"), /no demo organisation/);
  });
});

describe("demo actions", () => {
  const actions = demoActions();

  it("has overdue, due-soon, undated and completed work", () => {
    assert.ok(
      actions.filter((a) => a.status === "open" && (a.due_in_days ?? 0) < 0).length >= 2,
      "F172 needs more than one overdue action to be worth showing",
    );
    assert.ok(actions.some((a) => a.status === "open" && (a.due_in_days ?? -1) > 0));
    assert.ok(actions.some((a) => a.status === "open" && a.due_in_days === null));
    assert.ok(actions.some((a) => a.status === "completed"));
  });

  it("was all assigned by an admin, as F169 describes", () => {
    for (const action of actions) assert.equal(action.created_by_key, "admin");
  });

  it("assigns to more than one CAM, so the admin's team view is not one column", () => {
    assert.ok(new Set(actions.map((a) => a.assignee_key)).size >= 3);
  });

  it("never dates an action into the future of its own creation", () => {
    for (const action of actions) assert.ok(action.created_days_ago > 0);
  });
});

describe("demo replies", () => {
  const messages = demoOutreachMessages();
  const replies = demoReplyEvents();

  it("each answers a message that exists and was actually sent", () => {
    for (const reply of replies) {
      const message = messages[reply.outreach_message_index];
      assert.ok(message, `reply ${reply.id} points at no message`);
      assert.equal(message.send_status, "sent");
    }
  });

  it("covers every reply intent, so the inbox filters have something to filter", () => {
    const intents = new Set(replies.map((reply) => reply.intent));
    for (const intent of ["interested", "not_interested", "more_info"] as const) {
      assert.ok(intents.has(intent), `no demo reply reads as ${intent}`);
    }
  });

  it("carries a turnaround on every reply, for the response-time reading", () => {
    for (const reply of replies) assert.ok(reply.response_time_seconds > 0);
  });
});

describe("demo notifications", () => {
  const notifications = demoNotifications();

  it("leaves some unread, so the bell has a count", () => {
    assert.ok(notifications.filter((n) => !n.read).length >= 2);
  });

  it("covers both the reply layer and the reminder layer", () => {
    const types = new Set(notifications.map((n) => n.notification_type));
    assert.ok(types.has("reply_received"));
    assert.ok(types.has("action_reminder"));
  });

  it("only ever links to an in-app path", () => {
    for (const notification of notifications) {
      assert.ok(notification.link_path.startsWith("/"));
    }
  });
});

describe("demo audit trail", () => {
  const entries = demoAuditEntries();

  it("covers every action the change-history feed renders", () => {
    const actions = new Set(entries.map((entry) => entry.action));
    for (const action of [
      "status_changed",
      "ownership_reassigned",
      "edit_suggestion_approved",
      "edit_suggestion_rejected",
      "field_discrepancy_resolved",
      "field_discrepancy_auto_resolved",
    ]) {
      assert.ok(actions.has(action), `change history has no ${action} row to show`);
    }
  });

  it("leaves ownership_reassigned's user ids for the seeder to fill in", () => {
    // The fixtures cannot know the cast's uuids; the seeder resolves them. A
    // hardcoded id here would insert a dangling reference instead.
    for (const entry of entries) {
      if (entry.action !== "ownership_reassigned") continue;
      assert.equal(entry.detail.from, null);
      assert.equal(entry.detail.to, null);
    }
  });
});

describe("the cast", () => {
  it("is four 180dc.org accounts, not four invented addresses", () => {
    const emails = Object.values(DEMO_CAST_EMAILS);
    assert.equal(emails.length, 4);
    assert.equal(new Set(emails).size, 4);
    for (const email of emails) assert.match(email, /@180dc\.org$/);
  });

  it("is who every fixture points at", () => {
    const keys = new Set(Object.keys(DEMO_CAST_EMAILS));
    for (const org of demoOrganisations()) {
      if (org.owner_key) assert.ok(keys.has(org.owner_key));
    }
    for (const action of demoActions()) {
      assert.ok(keys.has(action.assignee_key));
      assert.ok(keys.has(action.created_by_key));
    }
    for (const message of demoOutreachMessages()) assert.ok(keys.has(message.sent_by_key));
    for (const suggestion of demoEditSuggestions()) {
      assert.ok(keys.has(suggestion.requested_by_key));
    }
    for (const note of demoNotes()) assert.ok(keys.has(note.author_key));
    for (const notification of demoNotifications()) {
      assert.ok(keys.has(notification.recipient_key));
      if (notification.actor_key) assert.ok(keys.has(notification.actor_key));
    }
    for (const entry of demoAuditEntries()) {
      if (entry.actor_key) assert.ok(keys.has(entry.actor_key));
    }
  });
});
