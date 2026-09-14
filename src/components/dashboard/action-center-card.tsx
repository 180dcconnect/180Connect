import Link from "next/link";
import type { NeedsAttentionItem } from "@/lib/dashboard-metrics";

/**
 * Action Center Card — unified view of all actionable items requiring the CAM's attention:
 * - Overdue actions / tasks
 * - Inbound replies awaiting response
 * - Follow-ups due / urgent
 * - Truly stalled clients (no_response)
 *
 * In-flight outreach within the normal silence window is intentionally excluded.
 */
const VISIBLE_LIMIT = 6;

export function ActionCenterCard({
  items,
  actorId,
}: {
  items: NeedsAttentionItem[];
  actorId: string;
}) {
  const urgentCount = items.filter(
    (item) => item.overdueAction || item.followUp?.urgency === "urgent" || (item.isInboundReply && item.isUnreadReply),
  ).length;

  const visible = items.slice(0, VISIBLE_LIMIT);
  const hidden = items.length - visible.length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-panel border border-rule bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-5">
        <h3 className="font-body text-[16px] font-semibold tracking-tight text-ink">
          Action items
        </h3>
        <p className="font-body text-[12px] font-medium text-dim">
          {items.length === 0
            ? "Nothing requires attention"
            : urgentCount > 0
              ? `${items.length} ${items.length === 1 ? "item" : "items"} · ${urgentCount} urgent`
              : `${items.length} ${items.length === 1 ? "item" : "items"}`}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="px-5 pb-8 pt-2 font-body text-sm leading-[1.7] text-dim">
          You are all caught up. No overdue actions, unhandled replies, or due follow-ups right now.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-rule-soft border-t border-rule-soft">
            {visible.map((item) => {
              const href = item.isInboundReply
                ? "/inbox?tab=inbound"
                : item.overdueAction
                  ? `/clients/${item.id}?tab=actions`
                  : `/clients/${item.id}`;

              // Rail color
              const railClass = item.overdueAction || item.followUp?.urgency === "urgent"
                ? "bg-stop"
                : item.isInboundReply
                  ? "bg-go"
                  : item.followUp?.urgency === "due"
                    ? "bg-hold"
                    : "bg-faint";

              // Contextual explanation subtitle
              const subtitle = item.overdueAction
                ? `Task: "${item.overdueAction.title}" · Overdue since ${item.overdueAction.dueDate}`
                : item.isInboundReply
                  ? `Inbound reply awaiting response${item.isUnreadReply ? " · New" : ""}`
                  : item.followUp
                    ? `Silent ${item.followUp.daysWaiting} day${item.followUp.daysWaiting === 1 ? "" : "s"} · ${item.outreachStatusLabel}`
                    : `No response after outreach sequence · Outcome decision required`;

              return (
                <li key={item.id}>
                  <Link
                    href={href}
                    className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-paper-sunk/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead"
                  >
                    {/* Urgency indicator rail */}
                    <span
                      aria-hidden="true"
                      className={`h-8 w-[3px] shrink-0 rounded-full ${railClass}`}
                    />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-body text-[14.5px] font-bold text-ink">
                        {item.legalName}
                      </span>
                      <span className="mt-0.5 block truncate font-body text-[12px] text-dim">
                        {subtitle}
                      </span>
                    </span>

                    {/* Trigger badges */}
                    <div className="flex shrink-0 items-center gap-2">
                      {item.overdueAction && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-stop-wash px-2.5 py-1 font-body text-[11px] leading-none font-semibold text-stop">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                          Overdue action
                        </span>
                      )}

                      {item.isInboundReply && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-go-wash px-2.5 py-1 font-body text-[11px] leading-none font-semibold text-go">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                          Inbound reply
                        </span>
                      )}

                      {item.followUp && !item.overdueAction && (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-body text-[11px] leading-none font-semibold ${
                            item.followUp.urgency === "urgent"
                              ? "bg-stop-wash text-stop"
                              : "bg-paper-sunk text-dim"
                          }`}
                        >
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                          {item.followUp.urgency === "urgent" ? "Follow up now" : "Follow-up due"}
                        </span>
                      )}

                      {item.isStalled && !item.overdueAction && !item.followUp && !item.isInboundReply && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-sunk px-2.5 py-1 font-body text-[11px] leading-none font-semibold text-dim">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                          No response
                        </span>
                      )}

                      <span
                        aria-hidden="true"
                        className="text-faint transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-dim"
                      >
                        →
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {hidden > 0 && (
            <Link
              href={`/clients?owner=${actorId}`}
              className="border-t border-rule-soft px-5 py-3 font-body text-[12px] font-semibold text-dim transition-colors hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lead"
            >
              +{hidden} more — view all my clients →
            </Link>
          )}
        </>
      )}
    </div>
  );
}

export default ActionCenterCard;
