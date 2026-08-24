import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatTeamActivity,
  formatTeamActivities,
  type RawTeamActivityRow,
} from "./team-activity.ts";

function row(overrides: Partial<RawTeamActivityRow> = {}): RawTeamActivityRow {
  return {
    id: "act-1",
    actor_user_id: "user-1",
    actor_name: "Mohammed Saeed",
    action: "ownership_reassigned",
    target_table: "organisations",
    target_id: "org-1",
    target_name: "Oxford Homeless Project",
    detail: { from: null, to: "user-1", trigger: "self_claim" },
    created_at: "2026-08-17T12:00:00Z",
    ...overrides,
  };
}

describe("formatTeamActivity (F029)", () => {
  const now = new Date("2026-08-17T12:30:00Z");

  it("attributes actions to the specific user by real name (AC2)", () => {
    const activity = formatTeamActivity(row({ actor_name: "Sarah Jenkins" }), now);
    assert.equal(activity.actorName, "Sarah Jenkins");
    assert.match(activity.sentence, /^Sarah Jenkins/);
  });

  // The detail shapes below mirror what the RPCs actually insert: claim_organisation
  // (20260806140000) writes trigger 'self_claim', reassign_ownership (20260804170000)
  // writes 'bulk_assign' or 'offboarding'. Both use the ownership_reassigned token.
  it("formats self ownership claims", () => {
    const activity = formatTeamActivity(
      row({
        actor_name: "Mohammed Saeed",
        action: "ownership_reassigned",
        target_name: "Cancer Research UK",
        detail: { from: null, to: "cam-1", trigger: "self_claim" },
      }),
      now,
    );
    assert.equal(
      activity.sentence,
      "Mohammed Saeed claimed ownership of Cancer Research UK",
    );
    assert.equal(activity.actionLabel, "Ownership");
  });

  it("formats a first assignment onto an unowned client as a reassignment (F164)", () => {
    const activity = formatTeamActivity(
      row({
        actor_name: "Bashir Admin",
        action: "ownership_reassigned",
        target_name: "Cancer Research UK",
        detail: {
          from: null,
          to: "cam-1",
          reason: "First owner",
          trigger: "bulk_assign",
        },
      }),
      now,
    );
    assert.equal(
      activity.sentence,
      "Bashir Admin reassigned ownership of Cancer Research UK",
    );
    assert.equal(activity.actionLabel, "Ownership");
  });

  it("still formats legacy ownership_assigned rows", () => {
    const activity = formatTeamActivity(
      row({
        actor_name: "Bashir Admin",
        action: "ownership_assigned",
        target_name: "Cancer Research UK",
        detail: { to: "cam-1" },
      }),
      now,
    );
    assert.equal(
      activity.sentence,
      "Bashir Admin assigned ownership of Cancer Research UK",
    );
    assert.equal(activity.actionLabel, "Ownership");
  });

  it("formats admin ownership reassignments (F164)", () => {
    const activity = formatTeamActivity(
      row({
        actor_name: "Bashir Admin",
        action: "ownership_reassigned",
        target_name: "Cancer Research UK",
        detail: {
          from: "cam-1",
          to: "cam-2",
          reason: "Workload rebalance",
          trigger: "bulk_assign",
        },
      }),
      now,
    );
    assert.equal(
      activity.sentence,
      "Bashir Admin reassigned ownership of Cancer Research UK",
    );
    assert.equal(activity.actionLabel, "Ownership");
  });

  it("formats pipeline status changes", () => {
    const activity = formatTeamActivity(
      row({
        actor_name: "Sarah Jenkins",
        action: "status_changed",
        target_name: "St Mungo's",
        detail: { from: "not_contacted", to: "initial_outreach_sent" },
      }),
      now,
    );
    assert.equal(
      activity.sentence,
      "Sarah Jenkins moved St Mungo's to Initial outreach sent",
    );
    assert.equal(activity.actionLabel, "Pipeline");
  });

  it("formats batch client additions in the described format (AC1)", () => {
    const activity = formatTeamActivity(
      row({
        actor_name: "Bashir Bobboi",
        action: "clients_imported",
        target_name: null,
        detail: { count: 5 },
      }),
      now,
    );
    assert.equal(activity.sentence, "5 clients added by Bashir Bobboi");
    assert.equal(activity.actionLabel, "Import");
  });

  it("formats suppression requests and approvals", () => {
    const requested = formatTeamActivity(
      row({
        actor_name: "Mohammed Saeed",
        action: "suppression_requested",
        target_name: "Amnesty International",
      }),
      now,
    );
    assert.equal(
      requested.sentence,
      "Mohammed Saeed requested suppression of Amnesty International",
    );

    const approved = formatTeamActivity(
      row({
        actor_name: "Admin User",
        action: "suppression_approved",
        target_name: "Amnesty International",
      }),
      now,
    );
    assert.equal(
      approved.sentence,
      "Admin User approved suppression of Amnesty International",
    );

    const lifted = formatTeamActivity(
      row({
        actor_name: "Admin User",
        action: "suppression_lifted",
        target_name: "Amnesty International",
      }),
      now,
    );
    assert.equal(
      lifted.sentence,
      "Admin User lifted suppression of Amnesty International",
    );
    assert.equal(lifted.actionLabel, "Suppression");
  });

  it("formats team join events with Assign clients button when user has 0 clients", () => {
    const activity = formatTeamActivity(
      row({
        actor_name: "Alex Smith",
        action: "invite_accepted",
        target_table: "users",
        target_id: "user-new",
      }),
      now,
      0,
    );
    assert.equal(activity.sentence, "Alex Smith joined the team");
    assert.equal(activity.actionLabel, "Joined");
    assert.deepEqual(activity.actionButton, {
      label: "Assign clients",
      href: "/clients?owner=unassigned",
    });
    assert.equal(activity.targetHref, "/clients?owner=unassigned");
  });

  it("formats team join events without Assign clients button when user already has clients", () => {
    const activity = formatTeamActivity(
      row({
        actor_name: "Alex Smith",
        action: "invite_accepted",
        target_table: "users",
        target_id: "user-new",
      }),
      now,
      3,
    );
    assert.equal(activity.sentence, "Alex Smith joined the team");
    assert.equal(activity.actionLabel, "Joined");
    assert.equal(activity.actionButton, null);
  });

  it("links to the client profile when target is an organisation", () => {
    const activity = formatTeamActivity(
      row({ target_table: "organisations", target_id: "org-123" }),
      now,
    );
    assert.equal(activity.targetHref, "/clients/org-123");
  });

  it("computes relative time against the provided clock", () => {
    const activity = formatTeamActivity(
      row({ created_at: "2026-08-17T12:20:00Z" }),
      now,
    );
    assert.equal(activity.relativeTime, "10 minutes ago");
  });
});

describe("formatTeamActivities (F029)", () => {
  const now = new Date("2026-08-17T12:30:00Z");

  it("filters out actions performed by the current user when excludeActorId is passed", () => {
    const rows = [
      row({ id: "1", actor_user_id: "my-id", actor_name: "Me" }),
      row({ id: "2", actor_user_id: "other-id", actor_name: "Teammate" }),
    ];
    const result = formatTeamActivities(rows, "my-id", now);
    assert.equal(result.length, 1);
    assert.equal(result[0].actorName, "Teammate");
  });

  it("returns an empty array for empty data", () => {
    assert.deepEqual(formatTeamActivities([], "my-id", now), []);
  });
});
