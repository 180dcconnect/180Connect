"use client";

import Link from "next/link";
import { intentLabel, statusClass, statusLabel } from "@/lib/inbox-labels";
import type { InboxThread } from "@/lib/outreach-inbox";

/**
 * Gmail-style thread list — one row per organisation, newest activity first.
 * Clicking a row opens that thread's conversation (/inbox/[orgId]), where the
 * client context and the reply drawer live.
 *
 * The status/intent vocabulary comes from @/lib/inbox-labels, shared with the
 * thread view's context rail so the two can never drift into two names for the
 * same state.
 */

export function ThreadList({ threads }: { threads: InboxThread[] }) {
  if (threads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center text-sm text-muted-foreground">
        No outreach yet. Threads will appear here once the first email is sent.
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
      {threads.map((thread) => {
        // Computed server-side against one clock (buildInboxThreads' `now`)
        // rather than here, where the browser's clock could disagree with the
        // server's render near the 48-hour boundary.
        const fresh = thread.isRecent;
        return (
        <Link
          key={thread.orgId}
          href={thread.href}
          className={`block px-4 py-3 transition-colors hover:bg-gray-50 ${fresh ? "bg-emerald-50/40" : ""}`}
        >
          <div className="flex items-start justify-between gap-3">
            {/* Left: org name + status */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`truncate text-sm text-foreground ${fresh ? "font-bold" : "font-medium"}`}
                >
                  {thread.orgName}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-none ${statusClass(thread.status)}`}
                >
                  {statusLabel(thread.status)}
                </span>
                {thread.replyIntent && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {intentLabel(thread.replyIntent)}
                  </span>
                )}
              </div>

              {/* Subject + snippet */}
              <p className="mt-1 truncate text-sm text-foreground/80">{thread.subject}</p>
              {thread.snippet && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{thread.snippet}</p>
              )}

              {/* Meta */}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{thread.lastEventLabel}</span>
                <span>·</span>
                <span>{thread.lastActorName}</span>
                <span>·</span>
                <span>{thread.relativeTime}</span>
                {thread.messageCount > 1 && (
                  <>
                    <span>·</span>
                    <span>{thread.messageCount} messages</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </Link>
        );
      })}
    </div>
  );
}
