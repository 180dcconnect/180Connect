import Link from "next/link";
import { formatDueDate, groupMyActionsByDueDate, type MyAction } from "@/lib/actions";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { CompleteActionButton } from "./complete-action-button";

const ORIGIN_LABEL: Record<MyAction["origin"], (assignedByName: string | null) => string> = {
  self: () => "Self-added",
  system: () => "System-generated",
  assigned: (assignedByName) => `Assigned by ${assignedByName}`,
};

/**
 * One row. The client link and the "Mark complete" button are siblings, not
 * nested — a `<button>` inside an `<a>` is invalid HTML and the click target
 * would be ambiguous (F171 AC1).
 */
function ActionRow({ action }: { action: MyAction }) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-paper/70">
      <Link
        href={`/clients/${action.organisationId}`}
        className="group min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
      >
      <p className="font-body text-[15px] font-semibold text-ink">{action.title}</p>
      <p className="mt-0.5 truncate font-body text-sm font-semibold text-lead group-hover:underline">
        {action.organisationName}
      </p>
      {action.description && (
        <p className="mt-1 line-clamp-2 font-body text-[13px] leading-[1.6] text-dim">
          {action.description}
        </p>
      )}
      <p className="mt-1.5 font-body text-[12px] text-faint">
        {ORIGIN_LABEL[action.origin](action.assignedByName)}
      </p>
      </Link>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <Pill tone={action.priority === "high" ? "stop" : action.priority === "normal" ? "hold" : "neutral"}>
          {action.priority === "high" ? "High" : action.priority === "normal" ? "Normal" : "Low"}
        </Pill>
        {action.dueDate && (
          <Pill tone={action.isOverdue ? "stop" : "neutral"}>
            {action.isOverdue ? "Overdue · " : "Due "}
            {formatDueDate(action.dueDate)}
          </Pill>
        )}
        <CompleteActionButton actionId={action.id} />
      </div>
    </li>
  );
}

/** A labelled section, omitted entirely when empty rather than shown with "none". */
function ActionGroup({
  heading,
  actions,
}: {
  heading: string;
  actions: readonly MyAction[];
}) {
  if (actions.length === 0) return null;
  return (
    <div>
      <h2 className="px-1 font-body text-[18px] font-semibold tracking-[-0.01em] text-ink">
        {heading} <span className="font-normal tabular-nums text-dim">({actions.length})</span>
      </h2>
      <div className="mt-2 overflow-hidden rounded-panel border border-rule bg-white">
        <ul className="divide-y divide-rule-soft">
          {actions.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * F168 AC1/AC2 + F170 AC2/AC3 + F171 AC1: three labelled sections (overdue
 * leads, undated gets its own named section rather than a blank space), each
 * row offering "Mark complete" directly, no separate page or confirmation
 * step. Once complete_action flips a row to 'completed', the Server Action
 * revalidates this page and formatMyActions' own status filter drops it —
 * AC2 needs no special-casing here, it falls out of the existing filter.
 */
export function ActionsList({ actions }: { actions: readonly MyAction[] }) {
  if (actions.length === 0) {
    return (
      <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
        <p className="font-body text-[15px] font-semibold text-ink">
          Nothing outstanding — your task list is clear.
        </p>
      </div>
    );
  }

  const groups = groupMyActionsByDueDate(actions);

  return (
    <div className="space-y-6">
      <ActionGroup heading="Overdue" actions={groups.overdue} />
      <ActionGroup heading="Upcoming" actions={groups.upcoming} />
      <ActionGroup heading="No due date" actions={groups.noDueDate} />
    </div>
  );
}
