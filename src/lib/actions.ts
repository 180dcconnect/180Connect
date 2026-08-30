/**
 * F168 — My Actions Tab.
 *
 * Formatting logic behind the personal work-queue view, kept out of the page
 * so it can be tested without a database (same split as @/lib/timeline and
 * @/lib/note-history). The underlying table (20260801100000_create_actions.sql)
 * already existed before this ticket — it was built ahead of time for F257
 * (Reassign CAM When Offboarded) and already carries everything F168-F172
 * need: assignee_user_id, due_date, status, remind_at. This ticket's own
 * "Blocked By: Action model" is resolved by that table, not by inventing a
 * new one.
 *
 * Scope note: AC1 mentions system-generated actions "e.g. follow-up
 * recommendations (F160)" as one of the kinds of work this tab should show —
 * but F160 (src/lib/outreach/follow-up-recommendations.ts) is a live,
 * computed-on-the-fly panel for the dashboard's Needs Attention list, and
 * never writes an ACTIONS row. This tab reads ACTIONS only; whichever future
 * ticket wires a recommendation engine to actually insert rows there (rather
 * than only computing them per-dashboard-load) makes them appear here for
 * free, the same way F169's admin-assigned rows already will.
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

const UNKNOWN_CREATOR = "A former team member";

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
 * AC3: only open work belongs in the default view — completed (F171) and
 * cancelled actions are filtered out here as a defensive second layer, not
 * only in the page's own query, matching the rest of this codebase's "don't
 * trust the query alone" convention (formatOrganisationSources, etc.).
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
            ? row.created_by_user?.full_name?.trim() || UNKNOWN_CREATOR
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
