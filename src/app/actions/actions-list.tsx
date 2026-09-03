import Link from "next/link";
import { formatDueDate, type MyAction } from "@/lib/actions";
import { EmptyState } from "@/components/ui/empty-state";

const ORIGIN_LABEL: Record<MyAction["origin"], (assignedByName: string | null) => string> = {
  self: () => "Self-added",
  system: () => "System-generated",
  assigned: (assignedByName) => `Assigned by ${assignedByName}`,
};

/**
 * F168 — the queue itself (AC1, AC2). Same card-of-linked-rows shape as the
 * dashboard's AttentionList (F027), for one consistent "list of things about
 * a client" visual language across the app. Client-linking (AC2) is the
 * whole row, not a separate button — every row already leads somewhere, so
 * there is nothing else on it that isn't a link.
 */
export function ActionsList({ actions }: { actions: readonly MyAction[] }) {
  if (actions.length === 0) {
    return (
      <EmptyState message="Nothing outstanding — your queue is clear." />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
      <ul className="divide-y divide-black/[0.06]">
        {actions.map((action) => (
          <li key={action.id}>
            <Link
              href={`/clients/${action.organisationId}`}
              className="group flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              <div className="min-w-0 flex-1">
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
              </div>

              <div className="flex shrink-0 items-center gap-2">
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
                <span
                  aria-hidden="true"
                  className="text-foreground/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/55"
                >
                  →
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
