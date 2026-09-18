import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  digestNotificationBody,
  digestNotificationTitle,
  selectDigestActivities,
} from "./team-activity-digest.ts";
import type { RawTeamActivityRow } from "./team-activity.ts";

function row(overrides: Partial<RawTeamActivityRow> = {}): RawTeamActivityRow {
  return {
    id: "audit-1",
    actor_user_id: "cam-2",
    actor_name: "Sarah Jenkins",
    action: "status_changed",
    target_table: "organisations",
    target_id: "org-1",
    target_name: "1-1 Coco",
    detail: { to: "initial_outreach_sent" },
    created_at: "2026-09-03T10:00:00Z",
    ...overrides,
  };
}

describe("selectDigestActivities (F176 AC1)", () => {
  it("excludes the recipient's own actions", () => {
    const rows = [row({ actor_user_id: "cam-1" }), row({ id: "audit-2", actor_user_id: "cam-2" })];
    const result = selectDigestActivities(rows, "cam-1");
    assert.deepEqual(result.map((r) => r.id), ["audit-2"]);
  });

  it("keeps every teammate's action", () => {
    const rows = [
      row({ id: "a", actor_user_id: "cam-2" }),
      row({ id: "b", actor_user_id: "cam-3" }),
    ];
    const result = selectDigestActivities(rows, "cam-1");
    assert.equal(result.length, 2);
  });

  it("returns nothing when every event belongs to the recipient", () => {
    const rows = [row({ actor_user_id: "cam-1" }), row({ id: "audit-2", actor_user_id: "cam-1" })];
    assert.deepEqual(selectDigestActivities(rows, "cam-1"), []);
  });

  it("handles an empty batch", () => {
    assert.deepEqual(selectDigestActivities([], "cam-1"), []);
  });
});

describe("digestNotificationTitle (F176 AC1/AC2)", () => {
  it("pluralises correctly", () => {
    assert.equal(digestNotificationTitle(1), "1 team update");
    assert.equal(digestNotificationTitle(5), "5 team updates");
  });
});

describe("digestNotificationBody (F176 AC1)", () => {
  const now = new Date("2026-09-03T12:00:00Z");

  it("summarises a small batch in full", () => {
    const activities = [
      row({ id: "a", actor_name: "Sarah", action: "status_changed", detail: { to: "responded" } }),
      row({ id: "b", actor_name: "Mo", action: "ownership_assigned", target_name: "Amnesty" }),
    ];
    const body = digestNotificationBody(activities, now);
    assert.match(body, /Sarah/);
    assert.match(body, /Mo/);
    assert.ok(!body.includes("more"));
  });

  it("truncates a larger batch with a remaining count", () => {
    const activities = [
      row({ id: "a" }),
      row({ id: "b" }),
      row({ id: "c" }),
      row({ id: "d" }),
      row({ id: "e" }),
    ];
    const body = digestNotificationBody(activities, now);
    assert.match(body, /and 2 more/);
  });

  it("returns an empty string for an empty batch", () => {
    assert.equal(digestNotificationBody([], now), "");
  });
});
