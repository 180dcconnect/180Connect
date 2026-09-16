import Link from "next/link";

import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { formatDueDate, type MyAction } from "@/lib/actions";
import type { MyDesk } from "@/lib/dashboard/my-desk";

/**
 * Your actions — work with a date on it, and emails drafted but never sent.
 *
 * Replaces the Action Center. Its reply and follow-up rows already have homes
 * in the inbox (Inbound Replies, Follow-up Due); what nothing on the dashboard
 * showed was an action coming due this week, or a draft left sitting. Overdue
 * is decided by the Actions page's own rule (`summariseMyDesk`), so the card
 * and `/actions` never disagree about one action.
 */
const ACTION_ROWS = 5;
const DRAFT_ROWS = 3;

function ActionRowItem({ action }: { action: MyAction }) {
  return (
    <li>
      <Link
        href={`/clients/${action.organisationId}`}
        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body text-[14px] font-semibold text-ink">
            {action.title}
          </span>
          <span className="mt-0.5 block truncate font-body text-[12.5px] text-dim">
            {action.organisationName}
          </span>
        </span>
        {action.dueDate && (
          <Pill tone={action.isOverdue ? "stop" : "hold"}>
            {action.isOverdue ? "Overdue" : "Due"} {formatDueDate(action.dueDate)}
          </Pill>
        )}
      </Link>
    </li>
  );
}

export function MyActionsCard({ desk }: { desk: MyDesk }) {
  const dated = [...desk.overdue, ...desk.dueSoon];
  const shownActions = dated.slice(0, ACTION_ROWS);
  const hiddenActions = dated.length - shownActions.length;
  const shownDrafts = desk.drafts.slice(0, DRAFT_ROWS);
  const hiddenDrafts = desk.drafts.length - shownDrafts.length;
  const otherOpen = desk.laterCount + desk.undatedCount;

  return (
    <section
      aria-labelledby="my-actions-heading"
      className="flex h-full flex-col overflow-hidden rounded-panel border border-rule bg-white"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3">
        <div>
          <h2
            id="my-actions-heading"
            className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
          >
            Your actions
          </h2>
          <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">
            {desk.overdue.length > 0
              ? `${desk.overdue.length} overdue, ${desk.dueSoon.length} due in the next week.`
              : dated.length > 0
                ? `${dated.length} due in the next week.`
                : "Nothing overdue or due in the next week."}
          </p>
        </div>
        <Link
          href="/actions"
          className="font-body text-[13px] font-semibold text-lead transition-colors hover:text-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
        >
          All your actions →
        </Link>
      </div>

      {shownActions.length > 0 && (
        <ul className="divide-y divide-rule-soft border-t border-rule-soft">
          {shownActions.map((action) => (
            <ActionRowItem key={action.id} action={action} />
          ))}
        </ul>
      )}

      {(hiddenActions > 0 || otherOpen > 0) && (
        <p className="border-t border-rule-soft px-5 py-2.5 font-body text-[12.5px] text-dim">
          {[
            hiddenActions > 0 ? `${hiddenActions} more due this week` : null,
            otherOpen > 0 ? `${otherOpen} due later or with no date` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          {" — on the Actions page."}
        </p>
      )}

      <div className="border-t border-rule px-5 pt-3 pb-2">
        <h3 className="font-body text-[14px] font-semibold text-ink">Drafts not sent</h3>
        {desk.drafts.length === 0 && (
          <p className="mt-0.5 pb-1 font-body text-[12.5px] text-dim">
            No unsent drafts on your clients.
          </p>
        )}
      </div>
      {shownDrafts.length > 0 && (
        <ul className="divide-y divide-rule-soft">
          {shownDrafts.map((draft) => (
            <li key={draft.id}>
              <Link
                href={`/clients/${draft.organisationId}/outreach`}
                className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-[14px] font-semibold text-ink">
                    {draft.organisationName}
                  </span>
                  <span className="mt-0.5 block truncate font-body text-[12.5px] text-dim">
                    {draft.subject?.trim() || "No subject yet"}
                  </span>
                </span>
                <Pill tone="neutral" dot={false}>
                  Draft
                </Pill>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hiddenDrafts > 0 && (
        <p className="border-t border-rule-soft px-5 py-2.5 font-body text-[12.5px] text-dim">
          {hiddenDrafts} more {hiddenDrafts === 1 ? "draft" : "drafts"} not sent.
        </p>
      )}
    </section>
  );
}

export default MyActionsCard;
