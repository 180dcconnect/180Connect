import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignActionFailure,
  assigneeOwnerNote,
  completeActionFailure,
  formatDueDate,
  formatDueDateWithRelative,
  formatMyActions,
  formatTeamAssignedActions,
  formatTeamTasks,
  daysOverdue,
  getOrdinalSuffix,
  groupMyActionsByDueDate,
  isActionOverdue,
  isAdminAssignedRow,
  taskPriorityFromDb,
  taskPriorityToDb,
  validateAssignAction,
  validateUpdateTeamTask,
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
    updated_at: "2026-08-02T10:00:00Z",
    priority: 2,
    organisation: { legal_name: "1-1 Coco" },
    created_by_user: { full_name: "Priya Admin" },
    assignee: { full_name: "Sam CAM" },
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

describe("daysOverdue", () => {
  const now = new Date("2026-08-31T09:00:00Z");

  it("is 0 with no due date", () => {
    assert.equal(daysOverdue(null, now), 0);
  });

  it("is 0 when due today", () => {
    assert.equal(daysOverdue("2026-08-31", now), 0);
  });

  it("is 0 when due in the future", () => {
    assert.equal(daysOverdue("2026-09-05", now), 0);
  });

  it("counts whole calendar days past due", () => {
    assert.equal(daysOverdue("2026-08-30", now), 1);
    assert.equal(daysOverdue("2026-08-17", now), 14);
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

describe("getOrdinalSuffix", () => {
  it("computes the correct ordinal suffix for days of the month", () => {
    assert.equal(getOrdinalSuffix(1), "st");
    assert.equal(getOrdinalSuffix(2), "nd");
    assert.equal(getOrdinalSuffix(3), "rd");
    assert.equal(getOrdinalSuffix(4), "th");
    assert.equal(getOrdinalSuffix(11), "th");
    assert.equal(getOrdinalSuffix(12), "th");
    assert.equal(getOrdinalSuffix(13), "th");
    assert.equal(getOrdinalSuffix(19), "th");
    assert.equal(getOrdinalSuffix(21), "st");
    assert.equal(getOrdinalSuffix(22), "nd");
    assert.equal(getOrdinalSuffix(23), "rd");
    assert.equal(getOrdinalSuffix(31), "st");
  });
});

describe("formatDueDateWithRelative", () => {
  const now = new Date("2026-09-16T12:00:00Z");

  it("formats dates with ordinal, full month, year, and relative timing", () => {
    assert.equal(
      formatDueDateWithRelative("2026-09-19", now),
      "19th September 2026 (in 3 days)",
    );
    assert.equal(
      formatDueDateWithRelative("2026-09-17", now),
      "17th September 2026 (tomorrow)",
    );
    assert.equal(
      formatDueDateWithRelative("2026-09-16", now),
      "16th September 2026 (today)",
    );
    assert.equal(
      formatDueDateWithRelative("2026-09-15", now),
      "15th September 2026 (yesterday)",
    );
    assert.equal(
      formatDueDateWithRelative("2026-09-13", now),
      "13th September 2026 (3 days ago)",
    );
    assert.equal(
      formatDueDateWithRelative("2026-10-01", now),
      "1st October 2026 (in 15 days)",
    );
  });

  it("returns raw string if not a valid calendar date", () => {
    assert.equal(formatDueDateWithRelative("invalid-date", now), "invalid-date");
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
    assert.equal(action?.priority, "normal");
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

  it("excludes a completed action from the default view (F171 AC2)", () => {
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

describe("task priorities", () => {
  it("translates the database rank without exposing it to the UI", () => {
    assert.equal(taskPriorityFromDb(1), "high");
    assert.equal(taskPriorityFromDb(2), "normal");
    assert.equal(taskPriorityFromDb(3), "low");
    assert.equal(taskPriorityToDb("high"), 1);
    assert.equal(taskPriorityToDb("normal"), 2);
    assert.equal(taskPriorityToDb("low"), 3);
  });

  it("treats missing or unfamiliar legacy values as Normal", () => {
    assert.equal(taskPriorityFromDb(undefined), "normal");
    assert.equal(taskPriorityFromDb(null), "normal");
    assert.equal(taskPriorityFromDb(99), "normal");
  });
});

describe("groupMyActionsByDueDate", () => {
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

  it("returns empty buckets for an empty list", () => {
    assert.deepEqual(groupMyActionsByDueDate([]), { overdue: [], upcoming: [], noDueDate: [] });
  });
});

describe("completeActionFailure (F171 AC1)", () => {
  it("maps a permission refusal to a clear message", () => {
    const failure = completeActionFailure({ code: "42501", message: "denied" });
    assert.equal(failure.status, 403);
    assert.match(failure.error, /assigned to|admin/i);
  });

  it("maps a not-open conflict to 409, matching 'completed action' testing note", () => {
    const failure = completeActionFailure({ code: "55000", message: "not open" });
    assert.equal(failure.status, 409);
    assert.match(failure.error, /already.*completed/i);
  });

  it("maps a missing action to 404", () => {
    assert.equal(completeActionFailure({ code: "P0002", message: "not found" }).status, 404);
  });

  it("hides an unexpected error behind a generic message", () => {
    const failure = completeActionFailure({
      code: "42P01",
      message: 'relation "public.actions" does not exist',
    });
    assert.equal(failure.status, 500);
    assert.ok(!failure.error.includes("relation"));
  });

  it("hides a message-less error too", () => {
    assert.equal(completeActionFailure({ code: "42501", message: "  " }).status, 500);
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

describe("formatTeamTasks", () => {
  const now = new Date("2026-08-31T09:00:00Z");

  it("keeps admin-assigned, self-created and system tasks in the team tracker", () => {
    const tasks = formatTeamTasks(
      [
        teamRow({ id: "assigned" }),
        teamRow({
          id: "self",
          created_by_user_id: OTHER_CAM_ID,
          assignee_user_id: OTHER_CAM_ID,
        }),
        teamRow({ id: "system", created_by_user_id: null, created_by_user: null }),
      ],
      now,
    );

    assert.deepEqual(tasks.map((task) => task.origin), ["assigned", "self", "system"]);
  });

  it("shows an open task without an assignee as Unassigned", () => {
    const [task] = formatTeamTasks(
      [teamRow({ assignee_user_id: null, assignee: null })],
      now,
    );
    assert.equal(task?.assigneeName, "Unassigned");
  });

  it("keeps the former-team-member explanation on closed work", () => {
    const [task] = formatTeamTasks(
      [teamRow({ status: "completed", assignee_user_id: null, assignee: null })],
      now,
    );
    assert.equal(task?.assigneeName, "Former team member");
  });

  it("maps priority, overdue days and the concurrency timestamp", () => {
    const [task] = formatTeamTasks(
      [teamRow({ due_date: "2026-08-29", priority: 1 })],
      now,
    );
    assert.equal(task?.priority, "high");
    assert.equal(task?.isOverdue, true);
    assert.equal(task?.daysOverdue, 2);
    assert.equal(task?.updatedAt, "2026-08-02T10:00:00Z");
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
      assert.equal(result.data.priority, "normal");
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
    if (!result.success) assert.match(result.message, /team member/i);
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

  it("rejects an impossible calendar date", () => {
    const result = validateAssignAction({ ...validInput, dueDate: "2026-02-31" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /due date/i);
  });

  it("accepts a plain-English priority choice", () => {
    const result = validateAssignAction({ ...validInput, priority: "high" });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.priority, "high");
  });

  it("rejects a priority outside the offered choices", () => {
    const result = validateAssignAction({ ...validInput, priority: "urgent" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /High, Normal or Low/);
  });
});

describe("validateUpdateTeamTask", () => {
  const validInput = {
    actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    assigneeUserId: OTHER_CAM_ID,
    title: "Call the client",
    description: "Discuss the next steps.",
    dueDate: "2026-09-18",
    priority: "low",
    expectedUpdatedAt: "2026-09-17T10:00:00Z",
  };

  it("accepts editable task fields while leaving the linked client out", () => {
    const result = validateUpdateTeamTask(validInput);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.priority, "low");
      assert.equal(result.data.title, "Call the client");
    }
  });

  it("rejects an invalid priority", () => {
    const result = validateUpdateTeamTask({ ...validInput, priority: "urgent" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /High, Normal or Low/);
  });

  it("rejects a stale or missing update timestamp before the RPC", () => {
    const result = validateUpdateTeamTask({ ...validInput, expectedUpdatedAt: "" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /Refresh/);
  });
});

describe("assignActionFailure (F169)", () => {
  it("maps a permission refusal to a clear message", () => {
    assert.deepEqual(assignActionFailure({ code: "42501", message: "denied" }), {
      status: 403,
      error: "Only an administrator can assign tasks.",
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

/**
 * The line under the assignee picker. It reports a difference, never blocks
 * one — delegation to a non-owner is allowed — so every case here produces
 * either the fact or nothing, and none of them produces a refusal.
 */
describe("assigneeOwnerNote (F169)", () => {
  const base = {
    assigneeUserId: OTHER_CAM_ID,
    assigneeName: "Sam CAM",
    clientOwnerId: ACTOR_ID,
    clientOwnerName: "Dana Whitfield",
  };

  it("says nothing when the assignee owns the client", () => {
    assert.equal(
      assigneeOwnerNote({ ...base, clientOwnerId: OTHER_CAM_ID }),
      "",
    );
  });

  it("names both people when the assignee does not own the client", () => {
    assert.equal(
      assigneeOwnerNote(base),
      "Sam CAM doesn't own this client — it's owned by Dana Whitfield.",
    );
  });

  it("says nobody owns an unowned client, rather than blaming the assignee", () => {
    assert.equal(
      assigneeOwnerNote({ ...base, clientOwnerId: null, clientOwnerName: null }),
      "No one owns this client yet.",
    );
  });

  it("falls back when the owner's name did not come back with the row", () => {
    assert.equal(
      assigneeOwnerNote({ ...base, clientOwnerName: "  " }),
      "Sam CAM doesn't own this client — it's owned by another team member.",
    );
  });
});
