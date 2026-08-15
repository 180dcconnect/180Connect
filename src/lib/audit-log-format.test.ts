import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeAuditEvent,
  formatDetails,
  groupByDay,
  humaniseToken,
  matchesAuditQuery,
  type AuditResolvers,
  type AuditRow,
} from "./audit-log-format.ts";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const CAM = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

const resolvers: AuditResolvers = {
  user: (id) => (id === ADMIN ? "Bashir Bobboi" : id === CAM ? "Mohammed Saeed" : null),
  organisation: (id) => (id === ORG ? "Oxfam GB" : null),
};

const NOW = new Date("2026-08-15T12:00:00.000Z");

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "row-1",
    actor_user_id: ADMIN,
    action: "role_changed",
    target_table: "users",
    target_id: CAM,
    detail: { from: "cam", to: "admin" },
    created_at: "2026-08-15T11:30:00.000Z",
    ...overrides,
  };
}

describe("humaniseToken", () => {
  it("turns a snake_case action into a readable label", () => {
    assert.equal(humaniseToken("invite_cancelled"), "Invite cancelled");
  });

  it("survives a token with no underscore", () => {
    assert.equal(humaniseToken("converted"), "Converted");
  });
});

describe("describeAuditEvent", () => {
  it("names the actor and the target rather than showing their uuids", () => {
    const view = describeAuditEvent(row(), resolvers, NOW);
    assert.equal(view.sentence, "Bashir Bobboi changed the role of Mohammed Saeed");
    assert.equal(view.label, "Role changed");
    assert.ok(!view.sentence.includes(ADMIN));
    assert.ok(!view.sentence.includes(CAM));
  });

  it("falls back to a humanised token for an action it has never seen", () => {
    const view = describeAuditEvent(
      row({ action: "widget_frobnicated", detail: null }),
      resolvers,
      NOW,
    );
    assert.equal(view.label, "Widget frobnicated");
    assert.ok(view.sentence.includes("widget frobnicated"));
    assert.equal(view.tone, "neutral");
  });

  it("attributes an actor-less row to the system", () => {
    const view = describeAuditEvent(row({ actor_user_id: null }), resolvers, NOW);
    assert.ok(view.sentence.startsWith("The system "));
  });

  it("says so when the person behind an action no longer exists", () => {
    const view = describeAuditEvent(
      row({ actor_user_id: "44444444-4444-4444-8444-444444444444" }),
      resolvers,
      NOW,
    );
    assert.ok(view.sentence.startsWith("A removed account "));
  });

  it("says a record is gone rather than calling it anonymous", () => {
    const view = describeAuditEvent(
      { ...row({ action: "status_changed" }), target_table: "organisations", target_id: "nope" },
      resolvers,
      NOW,
    );
    assert.equal(view.sentence, "Bashir Bobboi moved a deleted client");
  });

  it("does not claim a record was deleted in a table it never looked in", () => {
    // Nothing resolves raw_source_records, so an unnamed one is unnamed, not gone.
    const view = describeAuditEvent(
      row({
        action: "client_criteria_rejected",
        target_table: "raw_source_records",
        target_id: "55555555-5555-4555-8555-555555555555",
        detail: null,
      }),
      resolvers,
      NOW,
    );
    assert.equal(view.sentence, "Bashir Bobboi screened out an imported record");
  });

  it("uses the anonymous noun when the row named no record at all", () => {
    const view = describeAuditEvent(
      { ...row({ action: "status_changed" }), target_table: "organisations", target_id: null },
      resolvers,
      NOW,
    );
    assert.equal(view.sentence, "Bashir Bobboi moved a client");
  });

  it("falls back to the email a cancelled invite left behind", () => {
    // Cancelling an invite deletes the account, so target_id resolves to nothing
    // and detail.email is the only record of who it was.
    const view = describeAuditEvent(
      row({
        action: "invite_cancelled",
        target_id: "deleted-account",
        detail: { email: "new.starter@180dc.org" },
      }),
      resolvers,
      NOW,
    );
    assert.equal(view.sentence, "Bashir Bobboi cancelled the invite for new.starter@180dc.org");
    // …and it is not then repeated as a chip under the sentence it just formed.
    assert.deepEqual(view.details, []);
  });

  it("still shows the email as a chip when the account is resolvable", () => {
    const view = describeAuditEvent(
      row({ action: "invite_cancelled", detail: { email: "new.starter@180dc.org" } }),
      resolvers,
      NOW,
    );
    assert.equal(view.sentence, "Bashir Bobboi cancelled the invite for Mohammed Saeed");
    assert.deepEqual(view.details, [
      { label: "Email", value: "new.starter@180dc.org", kind: "value" },
    ]);
  });

  it("does not say someone accepted the invite for themselves", () => {
    const view = describeAuditEvent(
      row({ action: "invite_accepted", actor_user_id: CAM, target_id: CAM, detail: null }),
      resolvers,
      NOW,
    );
    assert.equal(view.sentence, "Mohammed Saeed accepted their invite");
  });

  it("carries the ids through for the expanded panel", () => {
    const view = describeAuditEvent(row(), resolvers, NOW);
    assert.equal(view.actorId, ADMIN);
    assert.equal(view.targetId, CAM);
    assert.equal(view.targetTable, "users");
  });

  it("names the affected record the same way the sentence does", () => {
    assert.equal(describeAuditEvent(row(), resolvers, NOW).targetDisplay, "Mohammed Saeed");
    assert.equal(
      describeAuditEvent(
        row({ action: "invite_cancelled", target_id: "gone", detail: { email: "a@b.org" } }),
        resolvers,
        NOW,
      ).targetDisplay,
      "a@b.org",
    );
  });

  it("keeps the detail's own keys for the raw view", () => {
    const view = describeAuditEvent(row({ detail: { from: "cam", to: null } }), resolvers, NOW);
    assert.deepEqual(view.rawDetail, [
      { key: "from", value: "cam" },
      { key: "to", value: "null" },
    ]);
    assert.deepEqual(describeAuditEvent(row({ detail: null }), resolvers, NOW).rawDetail, []);
  });
});

describe("formatDetails", () => {
  it("collapses from/to into one transition and spells roles properly", () => {
    const details = formatDetails({ from: "cam", to: "admin" }, resolvers);
    assert.deepEqual(details, [{ label: "Changed", value: "CAM → Admin", kind: "transition" }]);
  });

  it("spells a pipeline transition the way /clients spells it", () => {
    const details = formatDetails({ from: "follow_up_sent", to: "responded" }, resolvers);
    assert.equal(details[0].value, "Follow up sent → Responded");
  });

  it("reads the active flag as words, not true/false", () => {
    const details = formatDetails({ from: false, to: true }, resolvers);
    assert.equal(details[0].value, "Inactive → Active");
  });

  it("reads any other flag as yes/no rather than active/inactive", () => {
    const details = formatDetails({ healthcare_aligned: false }, resolvers);
    assert.deepEqual(details, [{ label: "Healthcare aligned", value: "No", kind: "value" }]);
  });

  it("humanises a snake_case value, not only a snake_case key", () => {
    const details = formatDetails({ outcome: "needs_review" }, resolvers);
    assert.equal(details[0].value, "Needs review");
  });

  it("resolves a user id inside the detail to a name", () => {
    const details = formatDetails({ from_user_id: ADMIN, to_user_id: CAM }, resolvers);
    assert.deepEqual(details, [
      { label: "From", value: "Bashir Bobboi", kind: "value" },
      { label: "To", value: "Mohammed Saeed", kind: "value" },
    ]);
  });

  it("drops an id it cannot resolve rather than showing a uuid fragment", () => {
    const details = formatDetails(
      { to_user_id: "abcdef12-3456-4789-8abc-def012345678", note: "Left the team" },
      resolvers,
    );
    assert.deepEqual(details, [{ label: "Note", value: "Left the team", kind: "note" }]);
  });

  it("omits the keys the sentence already used", () => {
    const details = formatDetails({ email: "a@b.org", note: "Left" }, resolvers, ["email"]);
    assert.deepEqual(details, [{ label: "Note", value: "Left", kind: "note" }]);
  });

  it("drops the bookkeeping ids that mean nothing to a reader", () => {
    const details = formatDetails({ suppression_id: ORG, reason: "Asked to be removed" }, resolvers);
    assert.deepEqual(details, [{ label: "Reason", value: "Asked to be removed", kind: "note" }]);
  });

  it("returns nothing for an empty detail", () => {
    assert.deepEqual(formatDetails(null, resolvers), []);
    assert.deepEqual(formatDetails({}, resolvers), []);
  });
});

describe("matchesAuditQuery", () => {
  const view = describeAuditEvent(row({ action: "invite_cancelled", detail: { email: "a@b.org" } }), resolvers, NOW);

  it("matches the words the reader can actually see", () => {
    assert.equal(matchesAuditQuery(view, "invite cancelled"), true);
    assert.equal(matchesAuditQuery(view, "bashir"), true);
    assert.equal(matchesAuditQuery(view, "a@b.org"), true);
  });

  it("still matches the underlying token", () => {
    assert.equal(matchesAuditQuery(view, "invite_cancelled"), true);
  });

  it("requires every word, not any", () => {
    assert.equal(matchesAuditQuery(view, "invite suppression"), false);
  });

  it("matches everything on an empty query", () => {
    assert.equal(matchesAuditQuery(view, "   "), true);
  });
});

describe("groupByDay", () => {
  it("splits the feed at each calendar day, keeping order", () => {
    const views = [
      describeAuditEvent(row({ id: "a", created_at: "2026-08-15T11:00:00.000Z" }), resolvers, NOW),
      describeAuditEvent(row({ id: "b", created_at: "2026-08-15T09:00:00.000Z" }), resolvers, NOW),
      describeAuditEvent(row({ id: "c", created_at: "2026-08-14T09:00:00.000Z" }), resolvers, NOW),
    ];
    const groups = groupByDay(views);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].events.map((event) => event.id), ["a", "b"]);
    assert.deepEqual(groups[1].events.map((event) => event.id), ["c"]);
  });

  it("labels the two most recent days in words", () => {
    const groups = groupByDay([
      describeAuditEvent(row({ created_at: "2026-08-15T11:00:00.000Z" }), resolvers, NOW),
      describeAuditEvent(row({ id: "b", created_at: "2026-08-14T11:00:00.000Z" }), resolvers, NOW),
    ]);
    assert.equal(groups[0].label, "Today");
    assert.equal(groups[1].label, "Yesterday");
  });
});
