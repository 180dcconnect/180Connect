import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignActionFailure,
  formatDueDate,
  formatMyActions,
  formatTeamAssignedActions,
  isActionOverdue,
  isAdminAssignedRow,
  validateAssignAction,
  type ActionRow,
  type TeamActionRow,
} from "./actions.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CAM_ID = "33333333-3333-4333-8333-333333333333";

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

function teamRow(overrides: Partial<TeamActionRow> = {}): TeamActionRow {
  return {
    id: "action-1",
    title: "Send follow-up email",
    description: null,
    due_date: "2026-08-30",
    status: "open",
    organisation_id: "org-1",
    created_by_user_id: ADMIN_ID,
    assignee_user_id: OTHER_CAM_ID,
    created_at: "2026-08-01T10:00:00Z",
    organisation: { legal_name: "1-1 Coco" },
    created_by_user: { full_name: "Priya Admin" },
    assignee: { full_name: "Sam CAM" },
    ...overrides,
  };
}

describe("isActionOverdue", () => {
  const now = new Date("2026-08-30T09:00:00Z");

  it("is not overdue with no due date", () => {
    assert.equal(isActionOverdue(null, now), false);
  });

  it("is not overdue when due today", () => {
    assert.equal(isActionOverdue("2026-08-30", now), false);
  });

  it("is overdue when due date is in the past", () => {
    assert.equal(isActionOverdue("2026-08-29", now), true);
  });

  it("is not overdue when due in the future", () => {
    assert.equal(isActionOverdue("2026-08-31", now), false);
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
  const now = new Date("2026-08-30T09:00:00Z");

  it("shows an assigned action with who assigned it (AC1/AC2, F169-style)", () => {
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

  it("treats a null creator as system-generated", () => {
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

  it("excludes a completed action from the default view (AC3)", () => {
    assert.deepEqual(formatMyActions([row({ status: "completed" })], ACTOR_ID, now), []);
  });

  it("excludes a cancelled action too — only open work is outstanding", () => {
    assert.deepEqual(formatMyActions([row({ status: "cancelled" })], ACTOR_ID, now), []);
  });

  it("flags an overdue action", () => {
    const [action] = formatMyActions([row({ due_date: "2026-08-01" })], ACTOR_ID, now);
    assert.equal(action?.isOverdue, true);
  });

  it("handles a client with missing data — no description, no due date", () => {
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

  it("sorts overdue and soon-due actions before undated ones", () => {
    const actions = formatMyActions(
      [
        row({ id: "no-date", due_date: null }),
        row({ id: "later", due_date: "2026-09-15" }),
        row({ id: "overdue", due_date: "2026-08-01" }),
        row({ id: "soon", due_date: "2026-08-31" }),
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

describe("isAdminAssignedRow (F169 AC1)", () => {
  it("is true when a different person created it than who it's assigned to", () => {
    assert.equal(
      isAdminAssignedRow({ created_by_user_id: ADMIN_ID, assignee_user_id: OTHER_CAM_ID }),
      true,
    );
  });

  it("is false for a CAM's own self-created action", () => {
    assert.equal(
      isAdminAssignedRow({ created_by_user_id: ACTOR_ID, assignee_user_id: ACTOR_ID }),
      false,
    );
  });

  it("is false for a system-generated action (no creator on record)", () => {
    assert.equal(
      isAdminAssignedRow({ created_by_user_id: null, assignee_user_id: OTHER_CAM_ID }),
      false,
    );
  });
});

describe("formatTeamAssignedActions (F169 AC1/AC3)", () => {
  const now = new Date("2026-08-30T09:00:00Z");

  it("shows assignee and assigner names for an admin-assigned action", () => {
    const [action] = formatTeamAssignedActions([teamRow()], now);
    assert.equal(action?.assigneeName, "Sam CAM");
    assert.equal(action?.assignedByName, "Priya Admin");
    assert.equal(action?.organisationName, "1-1 Coco");
  });

  it("excludes a CAM's own self-created action from the team-assigned view", () => {
    assert.deepEqual(
      formatTeamAssignedActions(
        [teamRow({ created_by_user_id: OTHER_CAM_ID, assignee_user_id: OTHER_CAM_ID })],
        now,
      ),
      [],
    );
  });

  it("excludes a system-generated action (no creator on record)", () => {
    assert.deepEqual(
      formatTeamAssignedActions([teamRow({ created_by_user_id: null })], now),
      [],
    );
  });

  it("keeps a completed action visible, unlike the personal queue (AC3 contrast)", () => {
    const actions = formatTeamAssignedActions(
      [teamRow({ id: "done", status: "completed" })],
      now,
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "completed");
  });

  it("sorts open work before completed/cancelled work", () => {
    const actions = formatTeamAssignedActions(
      [
        teamRow({ id: "done", status: "completed", due_date: null }),
        teamRow({ id: "open-one", status: "open", due_date: "2026-09-01" }),
      ],
      now,
    );
    assert.deepEqual(actions.map((a) => a.id), ["open-one", "done"]);
  });

  it("does not mark a completed action overdue even with a past due date", () => {
    const [action] = formatTeamAssignedActions(
      [teamRow({ status: "completed", due_date: "2026-01-01" })],
      now,
    );
    assert.equal(action?.isOverdue, false);
  });

  it("falls back when the assignee can no longer be identified", () => {
    const [action] = formatTeamAssignedActions([teamRow({ assignee: null })], now);
    assert.equal(action?.assigneeName, "A former team member");
  });

  it("returns an empty list when nothing has been admin-assigned", () => {
    assert.deepEqual(formatTeamAssignedActions([], now), []);
  });
});

describe("validateAssignAction (F169 AC1)", () => {
  const validInput = {
    organisationId: "11111111-1111-4111-8111-111111111111",
    assigneeUserId: "22222222-2222-4222-8222-222222222222",
    title: "Send updated proposal",
    description: "Include the revised budget.",
    dueDate: "2026-09-01",
  };

  it("accepts a fully filled-in submission", () => {
    const result = validateAssignAction(validInput);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.title, "Send updated proposal");
      assert.equal(result.data.dueDate, "2026-09-01");
    }
  });

  it("accepts a submission with no description or due date", () => {
    const result = validateAssignAction({
      ...validInput,
      description: "",
      dueDate: "",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.description, null);
      assert.equal(result.data.dueDate, null);
    }
  });

  it("rejects a missing or malformed client id", () => {
    const result = validateAssignAction({ ...validInput, organisationId: "not-a-uuid" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /client/i);
  });

  it("rejects a missing or malformed assignee id", () => {
    const result = validateAssignAction({ ...validInput, assigneeUserId: "" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /CAM/i);
  });

  it("rejects a blank title", () => {
    const result = validateAssignAction({ ...validInput, title: "   " });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /what needs to be done/i);
  });

  it("rejects an invalid due date", () => {
    const result = validateAssignAction({ ...validInput, dueDate: "not-a-date" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /due date/i);
  });
});

describe("assignActionFailure (F169)", () => {
  it("maps a permission refusal to a clear message", () => {
    assert.deepEqual(assignActionFailure({ code: "42501", message: "denied" }), {
      status: 403,
      error: "Only an admin can assign actions.",
    });
  });

  it("maps a foreign key miss to 400", () => {
    assert.equal(assignActionFailure({ code: "23503", message: "fk violation" }).status, 400);
  });

  it("maps the blank-title constraint to 400", () => {
    assert.equal(assignActionFailure({ code: "23514", message: "blank" }).status, 400);
  });

  it("hides an unexpected error behind a generic message", () => {
    const failure = assignActionFailure({
      code: "42P01",
      message: 'relation "public.actions" does not exist',
    });
    assert.equal(failure.status, 500);
    assert.ok(!failure.error.includes("relation"));
  });

  it("hides a message-less error too", () => {
    assert.equal(assignActionFailure({ code: "42501", message: "  " }).status, 500);
  });
});
