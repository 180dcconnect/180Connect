/**
 * F168 My Actions Tab / F169 Admin-Assigned Actions.
 *
 * Formatting and validation logic behind the personal work-queue view and the
 * admin assignment workflow, kept out of the pages/routes so it can be tested
 * without a database (same split as @/lib/edit-suggestions and
 * @/lib/ownership-requests on this branch).
 *
 * The underlying table (20260801100000_create_actions.sql) already existed
 * before either ticket — it was built ahead of time for F257 (Reassign CAM
 * When Offboarded) and already carries everything F168-F172 need:
 * assignee_user_id, due_date, status, remind_at. Both tickets' "Blocked By"
 * questions ("Action model" / "None currently identified") are resolved by
 * that table, not by inventing a new one.
 *
 * F169 needs NO new migration either: docs/rls-permission-matrix.md §3.11
 * already documents `actions_insert_admin` as admin-any-row INSERT — "A CAM
 * assigning work to another CAM is F169 and stays admin-only — that is what
 * the assignee_user_id = auth.uid() predicate on INSERT enforces [for CAM]."
 * Creating a new admin-assigned action is a plain, already-permitted INSERT;
 * only *reassigning an existing* action needs the reason-carrying
 * reassign_actions RPC (F257's offboarding path), which this ticket does not
 * touch.
 */

import { z } from "zod";
import { nonEmptyTrimmed, safeValidate } from "./validation.ts";
import { dayKeyOf } from "./display-format.ts";

export type ActionStatus = "open" | "completed" | "cancelled";

export type ActionRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: ActionStatus;
  organisation_id: string;
  created_by_user_id: string | null;
  created_at: string;
  organisation: { legal_name: string } | null;
  created_by_user: { full_name: string | null } | null;
};

/**
 * Who/what put this on the CAM's queue — not a schema column, derived from
 * created_by_user_id relative to the viewer. `system` covers a future
 * automated writer (no human creator) as well as today's seed data; `self`
 * is a CAM's own actions_insert_cam row; `assigned` is F169's admin path.
 */
export type ActionOrigin = "self" | "system" | "assigned";

export type MyAction = {
  id: string;
  title: string;
  description: string | null;
  organisationId: string;
  organisationName: string;
  dueDate: string | null;
  isOverdue: boolean;
  origin: ActionOrigin;
  assignedByName: string | null;
};

const UNKNOWN_PERSON = "A former team member";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * "30 Aug" from a `date` column's "YYYY-MM-DD" string, parsed by hand rather
 * than through `new Date(dueDate)`: that parses a date-only ISO string as UTC
 * midnight, and formatting it back with the runtime's local timezone can shift
 * the displayed day by one depending on where the server/browser sits relative
 * to UTC — a real bug for a value that is a pure calendar date with no time of
 * day to begin with.
 */
export function formatDueDate(dueDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) return dueDate;
  const [, , month, day] = match;
  const monthLabel = MONTH_ABBR[Number(month) - 1] ?? month;
  return `${Number(day)} ${monthLabel}`;
}

/**
 * `due_date` is a Postgres `date` column — a plain "YYYY-MM-DD" string, never
 * a time. Comparing it against `now`'s own calendar-day key (not a timestamp
 * diff) is what keeps "due today" from reading as overdue depending on what
 * hour it is.
 */
export function isActionOverdue(dueDate: string | null, now: Date): boolean {
  if (!dueDate) return false;
  return dueDate < dayKeyOf(now);
}

/**
 * AC3 (F168): only open work belongs in the default view — completed (F171)
 * and cancelled actions are filtered out here as a defensive second layer,
 * not only in the page's own query, matching the rest of this codebase's
 * "don't trust the query alone" convention.
 *
 * Sorted so the top of the list is always the most urgent: ascending due
 * date, undated work last. Two actions due the same day keep their original
 * (oldest-created-first) relative order — Array.prototype.sort is stable.
 */
export function formatMyActions(
  rows: readonly ActionRow[],
  actorId: string,
  now: Date = new Date(),
): MyAction[] {
  return rows
    .filter((row) => row.status === "open")
    .map((row): MyAction => {
      const origin: ActionOrigin =
        row.created_by_user_id === actorId
          ? "self"
          : row.created_by_user_id === null
            ? "system"
            : "assigned";

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        organisationId: row.organisation_id,
        organisationName: row.organisation?.legal_name?.trim() || "Unknown client",
        dueDate: row.due_date,
        isOverdue: isActionOverdue(row.due_date, now),
        origin,
        assignedByName:
          origin === "assigned"
            ? row.created_by_user?.full_name?.trim() || UNKNOWN_PERSON
            : null,
      };
    })
    .sort((left, right) => {
      if (left.dueDate === right.dueDate) return 0;
      if (left.dueDate === null) return 1;
      if (right.dueDate === null) return -1;
      return left.dueDate < right.dueDate ? -1 : 1;
    });
}

// ---------------------------------------------------------------------------
// F169 — admin-assigned actions: the team-wide view.
// ---------------------------------------------------------------------------

export type TeamActionRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: ActionStatus;
  organisation_id: string;
  created_by_user_id: string | null;
  assignee_user_id: string | null;
  created_at: string;
  organisation: { legal_name: string } | null;
  created_by_user: { full_name: string | null } | null;
  assignee: { full_name: string | null } | null;
};

export type TeamAssignedAction = {
  id: string;
  title: string;
  description: string | null;
  organisationId: string;
  organisationName: string;
  dueDate: string | null;
  isOverdue: boolean;
  status: ActionStatus;
  assigneeName: string;
  assignedByName: string;
  createdAt: string;
};

/**
 * AC1: "distinct from system-generated actions" — an admin-assigned row is
 * exactly one where a real person created it for someone *other* than
 * themselves. `created_by_user_id === assignee_user_id` is a CAM's own
 * self-created action (actions_insert_cam forces the two to match); a null
 * creator is a future system writer. Neither is admin-assigned.
 */
export function isAdminAssignedRow(row: {
  created_by_user_id: string | null;
  assignee_user_id: string | null;
}): boolean {
  return row.created_by_user_id !== null && row.created_by_user_id !== row.assignee_user_id;
}

/**
 * AC3: every admin-assigned action across the team, outstanding and completed
 * both — unlike `formatMyActions`, nothing is filtered out by status here,
 * because the whole point is to contrast the two. Open work sorts first (by
 * urgency, same as the personal queue); completed/cancelled work follows,
 * most recently created first.
 */
export function formatTeamAssignedActions(
  rows: readonly TeamActionRow[],
  now: Date = new Date(),
): TeamAssignedAction[] {
  return rows
    .filter(isAdminAssignedRow)
    .map((row): TeamAssignedAction => ({
      id: row.id,
      title: row.title,
      description: row.description,
      organisationId: row.organisation_id,
      organisationName: row.organisation?.legal_name?.trim() || "Unknown client",
      dueDate: row.due_date,
      isOverdue: row.status === "open" && isActionOverdue(row.due_date, now),
      status: row.status,
      assigneeName: row.assignee?.full_name?.trim() || UNKNOWN_PERSON,
      assignedByName: row.created_by_user?.full_name?.trim() || UNKNOWN_PERSON,
      createdAt: row.created_at,
    }))
    .sort((left, right) => {
      const leftOpen = left.status === "open";
      const rightOpen = right.status === "open";
      if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;

      if (leftOpen) {
        if (left.dueDate === right.dueDate) return 0;
        if (left.dueDate === null) return 1;
        if (right.dueDate === null) return -1;
        return left.dueDate < right.dueDate ? -1 : 1;
      }
      if (left.createdAt === right.createdAt) return 0;
      return left.createdAt > right.createdAt ? -1 : 1;
    });
}

// ---------------------------------------------------------------------------
// F169 — creating and assigning a new action.
// ---------------------------------------------------------------------------

export type AssignActionInput = {
  organisationId: string;
  assigneeUserId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates one create-and-assign submission; same "return a message, don't
 * throw" shape as validateSuggestEdit. The RLS `with check` on
 * actions_insert_admin is the actual enforcement (app.is_admin() only, no
 * further constraint) — this is the friendlier first pass so a malformed
 * client/assignee id or a blank title never reaches the database at all.
 */
export function validateAssignAction(input: {
  organisationId: unknown;
  assigneeUserId: unknown;
  title: unknown;
  description: unknown;
  dueDate: unknown;
}): { success: true; data: AssignActionInput } | { success: false; message: string } {
  if (typeof input.organisationId !== "string" || !UUID_RE.test(input.organisationId)) {
    return { success: false, message: "Choose a client for this action." };
  }
  if (typeof input.assigneeUserId !== "string" || !UUID_RE.test(input.assigneeUserId)) {
    return { success: false, message: "Choose a CAM to assign this to." };
  }

  const parsed = safeValidate(
    z.object({ title: nonEmptyTrimmed(200, "Enter what needs to be done.") }),
    { title: input.title },
  );
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.fieldErrors.title?.[0] ?? "Enter what needs to be done.",
    };
  }

  const description =
    typeof input.description === "string" && input.description.trim()
      ? input.description.trim().slice(0, 2000)
      : null;

  let dueDate: string | null = null;
  if (typeof input.dueDate === "string" && input.dueDate.trim()) {
    const trimmed = input.dueDate.trim();
    if (!DATE_ONLY_RE.test(trimmed) || Number.isNaN(Date.parse(trimmed))) {
      return { success: false, message: "Enter a valid due date." };
    }
    dueDate = trimmed;
  }

  return {
    success: true,
    data: {
      organisationId: input.organisationId,
      assigneeUserId: input.assigneeUserId,
      title: parsed.data.title,
      description,
      dueDate,
    },
  };
}

export type RpcFailure = { status: number; error: string };

const ASSIGN_GENERIC_FAILURE = "The action could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from the plain ACTIONS insert onto something safe to
 * show an admin. `42501` is `actions_insert_admin`'s own WITH CHECK refusing
 * a non-admin (defense in depth — the route's own getCurrentActor gate is the
 * first line); `23503` is a foreign key miss (a client or CAM that no longer
 * exists by the time of submission); `23514` is the title-not-blank check
 * constraint, which validateAssignAction should already have caught.
 */
export function assignActionFailure(error: { code?: string; message?: string }): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: ASSIGN_GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: "Only an admin can assign actions." };
    case "23514":
      return { status: 400, error: "Enter what needs to be done." };
    case "23503":
      return { status: 400, error: "That client or CAM could not be found." };
    default:
      return { status: 500, error: ASSIGN_GENERIC_FAILURE };
  }
}
