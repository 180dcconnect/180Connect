/**
 * The dashboard's "Your actions" card, decided: the open actions assigned to
 * this person that are overdue or due within the week, and the emails they
 * drafted but never sent.
 *
 * Replaces the old Action Center, whose other rows (replies waiting, follow-ups
 * due) already have their own homes in the inbox's Inbound Replies and
 * Follow-up Due tabs. What had no home on the dashboard was work with a date on
 * it, and drafts sitting unsent.
 *
 * "Overdue" is decided by `formatMyActions` (via `isActionOverdue`), the same
 * rule the Actions page uses, so the two screens cannot disagree about one
 * action. Pure and dependency-free for `node --test`.
 */
import { dayKeyOf } from "../display-format.ts";
import type { MyAction } from "../actions.ts";

/** How far ahead "due soon" looks. */
export const DUE_SOON_DAYS = 7;

export type DeskDraft = {
  id: string;
  organisationId: string;
  organisationName: string;
  subject: string | null;
  updatedAt: string;
};

export type MyDesk = {
  /** Past their due date, most overdue first. */
  overdue: MyAction[];
  /** Due today or within DUE_SOON_DAYS, soonest first. */
  dueSoon: MyAction[];
  /** Open actions due after the window. */
  laterCount: number;
  /** Open actions with no due date. */
  undatedCount: number;
  /** Unsent drafts on this person's clients, most recently edited first. */
  drafts: DeskDraft[];
};

/**
 * `actions` must already be `formatMyActions` output — open only, ascending by
 * due date — which is what keeps both lists in the right order without
 * re-sorting here.
 */
export function summariseMyDesk(
  actions: readonly MyAction[],
  drafts: readonly DeskDraft[],
  now: Date = new Date(),
  days: number = DUE_SOON_DAYS,
): MyDesk {
  const windowEnd = dayKeyOf(new Date(now.getTime() + days * 24 * 60 * 60 * 1000));
  const overdue: MyAction[] = [];
  const dueSoon: MyAction[] = [];
  let laterCount = 0;
  let undatedCount = 0;

  for (const action of actions) {
    if (action.dueDate === null) undatedCount += 1;
    else if (action.isOverdue) overdue.push(action);
    else if (action.dueDate <= windowEnd) dueSoon.push(action);
    else laterCount += 1;
  }

  return {
    overdue,
    dueSoon,
    laterCount,
    undatedCount,
    drafts: [...drafts].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    ),
  };
}
