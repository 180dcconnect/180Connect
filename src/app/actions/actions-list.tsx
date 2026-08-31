import Link from "next/link";
import { formatDueDate, groupMyActionsByDueDate, type MyAction } from "@/lib/actions";
import { EmptyState } from "@/components/ui/empty-state";
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
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-black/[0.02]">
      <Link
        href={`/clients/${action.organisationId}`}
        className="group min-w-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <p className="text-[15px] font-bold text-foreground">{action.title}</p>
        <p className="mt-0.5 truncate text-sm font-bold text-brand-hover">
          {action.organisationName}
        </p>
        {action.description && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.6] text-foreground/50">
            {action.description}
          </p>
        )}
        <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/35">
          {ORIGIN_LABEL[action.origin](action.assignedByName)}
        </p>
      </Link>

      <div className="flex shrink-0 flex-col items-end gap-2">
        {action.dueDate && (
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] tabular-nums ${
              action.isOverdue
                ? "bg-destructive/10 text-destructive"
                : "bg-black/[0.05] text-foreground/55"
            }`}
          >
            {action.isOverdue ? "Overdue · " : "Due "}
            {formatDueDate(action.dueDate)}
          </span>
        )}
        <CompleteActionButton actionId={action.id} />
      </div>
    </li>
  );
}

/** A labelled section, omitted entirely when empty rather than shown with "none". */
function ActionGroup({ heading, actions }: { heading: string; actions: readonly MyAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div>
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/40">
        {heading} ({actions.length})
      </h2>
      <div className="mt-2 overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
        <ul className="divide-y divide-black/[0.06]">
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
    return <EmptyState message="Nothing outstanding — your queue is clear." />;
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
