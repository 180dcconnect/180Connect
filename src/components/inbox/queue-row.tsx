import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Pill } from "@/app/clients/[id]/section-card";
import {
  followUpLabel,
  followUpTone,
  intentLabel,
  statusLabel,
  statusTone,
} from "@/lib/inbox-labels";
import type { InboxQueueRow as QueueRowData } from "@/lib/inbox-queue";

/**
 * One row of the inbox queue.
 *
 * The whole row is a single link to the thread and nothing else is clickable.
 * That is a decision, not an omission: the previous inbox grew star, snooze,
 * archive and a reply box, none of which had a column behind them, so every one
 * of them lied the moment the page was refreshed. Sending stays where it is
 * approved — the thread's reply drawer, behind preflight and review.
 *
 * The row answers four questions in reading order: who, what state, what was
 * said, and how long it has been. `daysWaiting` sits on the right in mono
 * tabular figures so a column of them can be scanned as a column.
 */
export function QueueRow({ row }: { row: QueueRowData }) {
  return (
    <Link
      href={row.href}
      className="group flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-paper/70 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-ink transition-colors group-hover:text-lead">
            {row.orgName}
          </span>
          {!row.isMine && (
            // Only ever shown in the Team and All scopes, where whose queue a
            // row belongs to is the thing you cannot tell by looking.
            <span className="truncate text-[11.5px] text-faint">
              {row.ownerId ? "Team" : "Unassigned"}
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-[12.5px] text-dim">
          <span className="text-ink/85">{row.subject}</span>
          {row.snippet ? <span> — {row.snippet}</span> : null}
        </p>

        <p className="mt-1 truncate text-[11.5px] text-faint">
          {row.lastEventLabel} · {row.lastActorName} · {row.relativeTime} ·{" "}
          {row.messageCount} {row.messageCount === 1 ? "message" : "messages"}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
        <Pill tone={statusTone(row.status)}>{statusLabel(row.status)}</Pill>
        {row.replyIntent && (
          // Intent labels the reply rather than reporting a state of the
          // relationship, so it takes the accent tone and no dot.
          <Pill tone="lead" dot={false}>
            {intentLabel(row.replyIntent)}
          </Pill>
        )}
        {row.followUpUrgency && (
          <Pill tone={followUpTone(row.followUpUrgency)}>
            {followUpLabel(row.followUpUrgency)}
          </Pill>
        )}
        <span className="w-10 text-right font-mono text-[11.5px] tabular-nums text-faint">
          {row.daysWaiting}d
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
        />
      </div>
    </Link>
  );
}
