/**
 * F168 My Actions Tab / F171 Mark Action Complete.
 *
 * Formatting and RPC-failure-mapping logic behind the personal work-queue
 * view, kept out of the page/action so it can be tested without a database
 * (same split as @/lib/edit-suggestions and @/lib/ownership-requests on this
 * branch).
 *
 * The underlying table (20260801100000_create_actions.sql) already existed
 * before either ticket — built ahead of time for F257 (Reassign CAM When
 * Offboarded) — and already carries everything F168-F172 need:
 * assignee_user_id, due_date, status, remind_at. F171 adds one column
 * (completed_by_user_id, 20260913090000_create_complete_action_rpc.sql) and
 * one RPC (complete_action) — see that migration's header for why closing
 * the direct status/completed_at UPDATE was necessary rather than optional:
 * AC2's audit trail and AC3's "who completed it" cannot be produced by a
 * policy.
 */

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
 * F168 AC3 / F171 AC2: only open work belongs in the default view —
 * completed (F171) and cancelled actions are filtered out here as a
 * defensive second layer, not only in the page's own query, matching the
 * rest of this codebase's "don't trust the query alone" convention. This is
 * also what makes AC2 true for free: the moment complete_action flips a row
 * to 'completed', the next render of this list drops it.
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

export type MyActionGroups = {
  overdue: MyAction[];
  upcoming: MyAction[];
  noDueDate: MyAction[];
};

/**
 * Three explicit, labelled buckets rather than one flat list — "which of
 * these is urgent" and "which of these has no due date at all" are both
 * visible from the section headings alone. Each bucket inherits
 * formatMyActions' own ordering (ascending due date within `overdue` and
 * `upcoming`) without re-sorting.
 */
export function groupMyActionsByDueDate(actions: readonly MyAction[]): MyActionGroups {
  const overdue: MyAction[] = [];
  const upcoming: MyAction[] = [];
  const noDueDate: MyAction[] = [];

  for (const action of actions) {
    if (action.dueDate === null) noDueDate.push(action);
    else if (action.isOverdue) overdue.push(action);
    else upcoming.push(action);
  }

  return { overdue, upcoming, noDueDate };
}

// ---------------------------------------------------------------------------
// F171 — mark complete.
// ---------------------------------------------------------------------------

export type RpcFailure = { status: number; error: string };

const COMPLETE_GENERIC_FAILURE = "This action could not be marked complete. Refresh and try again.";

/**
 * Maps a Postgres error from complete_action onto something safe to show a
 * CAM. Every errcode below is one the RPC raises deliberately (see
 * 20260913090000_create_complete_action_rpc.sql); anything else gets the
 * generic string (DoD: no internals in a user-facing error).
 */
export function completeActionFailure(error: { code?: string; message?: string }): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: COMPLETE_GENERIC_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: "Only the person it's assigned to (or an admin) can complete this action." };
    case "55000":
      return { status: 409, error: "This action is no longer open — it may already be completed." };
    case "P0002":
      return { status: 404, error: "That action could not be found. Refresh and try again." };
    default:
      return { status: 500, error: COMPLETE_GENERIC_FAILURE };
  }
}
