import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatDueDate,
  formatMyActions,
  groupMyActionsByDueDate,
  isActionOverdue,
  type ActionRow,
} from "./actions.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: "action-1",
    title: "Send follow-up email",
    description: "They asked for a call back next week.",
    due_date: "2026-08-30",
    status: "open",
    organisation_id: "org-1",
    created_by_user_id: ADMIN_ID,
    created_at: "2026-08-01T10:00:00Z",
    organisation: { legal_name: "1-1 Coco" },
    created_by_user: { full_name: "Priya Admin" },
    ...overrides,
  };
}

describe("isActionOverdue", () => {
  const now = new Date("2026-08-31T09:00:00Z");

  it("is not overdue with no due date", () => {
    assert.equal(isActionOverdue(null, now), false);
  });

  it("is not overdue when due today", () => {
    assert.equal(isActionOverdue("2026-08-31", now), false);
  });

  it("is overdue when due date is in the past", () => {
    assert.equal(isActionOverdue("2026-08-30", now), true);
  });

  it("is not overdue when due in the future", () => {
    assert.equal(isActionOverdue("2026-09-01", now), false);
  });
});

describe("formatDueDate", () => {
  it("formats a due date without going through a timezone-sensitive Date parse", () => {
    assert.equal(formatDueDate("2026-08-30"), "30 Aug");
    assert.equal(formatDueDate("2026-01-01"), "1 Jan");
    assert.equal(formatDueDate("2026-12-31"), "31 Dec");
  });

  it("returns the raw string for something that isn't a plain calendar date", () => {
    assert.equal(formatDueDate("not-a-date"), "not-a-date");
  });
});

describe("formatMyActions (F168)", () => {
  const now = new Date("2026-08-31T09:00:00Z");

  it("shows an assigned action with who assigned it", () => {
    const [action] = formatMyActions([row()], ACTOR_ID, now);
    assert.equal(action?.origin, "assigned");
    assert.equal(action?.assignedByName, "Priya Admin");
    assert.equal(action?.organisationName, "1-1 Coco");
    assert.equal(action?.organisationId, "org-1");
    assert.equal(action?.title, "Send follow-up email");
  });

  it("marks an action the CAM raised for themselves as self, not assigned", () => {
    const [action] = formatMyActions(
      [row({ created_by_user_id: ACTOR_ID, created_by_user: { full_name: "Me" } })],
      ACTOR_ID,
      now,
    );
    assert.equal(action?.origin, "self");
    assert.equal(action?.assignedByName, null);
  });

  it("treats a null creator as system-generated (F170 AC1's 'or the system')", () => {
    const [action] = formatMyActions(
      [row({ created_by_user_id: null, created_by_user: null })],
      ACTOR_ID,
      now,
    );
    assert.equal(action?.origin, "system");
    assert.equal(action?.assignedByName, null);
  });

  it("falls back when the assigning admin can no longer be identified", () => {
    const [action] = formatMyActions(
      [row({ created_by_user_id: ADMIN_ID, created_by_user: null })],
      ACTOR_ID,
      now,
    );
    assert.equal(action?.assignedByName, "A former team member");
  });

  it("excludes a completed action from the default view", () => {
    assert.deepEqual(formatMyActions([row({ status: "completed" })], ACTOR_ID, now), []);
  });

  it("excludes a cancelled action too — only open work is outstanding", () => {
    assert.deepEqual(formatMyActions([row({ status: "cancelled" })], ACTOR_ID, now), []);
  });

  it("flags an overdue action", () => {
    const [action] = formatMyActions([row({ due_date: "2026-08-01" })], ACTOR_ID, now);
    assert.equal(action?.isOverdue, true);
  });

  it("shows null for a client with missing data — no description, no due date (AC3)", () => {
    const [action] = formatMyActions(
      [row({ description: null, due_date: null })],
      ACTOR_ID,
      now,
    );
    assert.equal(action?.description, null);
    assert.equal(action?.dueDate, null);
    assert.equal(action?.isOverdue, false);
  });

  it("falls back when the client itself can no longer be identified", () => {
    const [action] = formatMyActions([row({ organisation: null })], ACTOR_ID, now);
    assert.equal(action?.organisationName, "Unknown client");
  });

  it("sorts overdue and soon-due actions before undated ones (AC2)", () => {
    const actions = formatMyActions(
      [
        row({ id: "no-date", due_date: null }),
        row({ id: "later", due_date: "2026-09-15" }),
        row({ id: "overdue", due_date: "2026-08-01" }),
        row({ id: "soon", due_date: "2026-09-01" }),
      ],
      ACTOR_ID,
      now,
    );
    assert.deepEqual(actions.map((a) => a.id), ["overdue", "soon", "later", "no-date"]);
  });

  it("returns an empty list when nothing is assigned", () => {
    assert.deepEqual(formatMyActions([], ACTOR_ID, now), []);
  });
});

describe("groupMyActionsByDueDate (F170 AC2/AC3)", () => {
  const now = new Date("2026-08-31T09:00:00Z");

  it("splits into overdue, upcoming and no-due-date buckets", () => {
    const actions = formatMyActions(
      [
        row({ id: "overdue-1", due_date: "2026-08-01" }),
        row({ id: "upcoming-1", due_date: "2026-09-15" }),
        row({ id: "no-date-1", due_date: null }),
      ],
      ACTOR_ID,
      now,
    );
    const groups = groupMyActionsByDueDate(actions);
    assert.deepEqual(groups.overdue.map((a) => a.id), ["overdue-1"]);
    assert.deepEqual(groups.upcoming.map((a) => a.id), ["upcoming-1"]);
    assert.deepEqual(groups.noDueDate.map((a) => a.id), ["no-date-1"]);
  });

  it("puts an action due today in upcoming, not overdue", () => {
    const actions = formatMyActions([row({ due_date: "2026-08-31" })], ACTOR_ID, now);
    const groups = groupMyActionsByDueDate(actions);
    assert.equal(groups.overdue.length, 0);
    assert.equal(groups.upcoming.length, 1);
  });

  it("preserves the incoming (already-sorted) order within each bucket", () => {
    const actions = formatMyActions(
      [
        row({ id: "overdue-later", due_date: "2026-08-20" }),
        row({ id: "overdue-earlier", due_date: "2026-08-01" }),
      ],
      ACTOR_ID,
      now,
    );
    const groups = groupMyActionsByDueDate(actions);
    assert.deepEqual(groups.overdue.map((a) => a.id), ["overdue-earlier", "overdue-later"]);
  });

  it("returns empty buckets for an empty list", () => {
    assert.deepEqual(groupMyActionsByDueDate([]), {
      overdue: [],
      upcoming: [],
      noDueDate: [],
    });
  });

  it("every action count adds back up to the input, none dropped or duplicated", () => {
    const actions = formatMyActions(
      [
        row({ id: "a", due_date: "2026-08-01" }),
        row({ id: "b", due_date: "2026-09-15" }),
        row({ id: "c", due_date: null }),
        row({ id: "d", due_date: "2026-07-01" }),
      ],
      ACTOR_ID,
      now,
    );
    const groups = groupMyActionsByDueDate(actions);
    const total = groups.overdue.length + groups.upcoming.length + groups.noDueDate.length;
    assert.equal(total, actions.length);
  });
});
