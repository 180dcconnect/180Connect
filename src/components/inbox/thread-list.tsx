"use client";

import Link from "next/link";
import type { InboxThread } from "@/lib/outreach-inbox";

/**
 * Gmail-style thread list — one row per organisation, newest activity first.
 * Read-only: clicking a row navigates to the client page (existing outreach
 * flow lives there). No compose/reply/forward.
 */

const STATUS_LABEL: Record<string, string> = {
  replied: "Replied",
  awaiting: "Awaiting follow-up",
  sent: "Sent",
};

const STATUS_CLASS: Record<string, string> = {
  replied: "bg-emerald-100 text-emerald-700 border-emerald-200",
  awaiting: "bg-amber-100 text-amber-700 border-amber-200",
  sent: "bg-gray-100 text-gray-500 border-gray-200",
};

const INTENT_LABEL: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  more_info: "More info requested",
  referral: "Referral",
};

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
      {threads.map((thread) => (
        <Link
          key={thread.orgId}
          href={thread.href}
          className="block px-4 py-3 transition-colors hover:bg-gray-50"
        >
          <div className="flex items-start justify-between gap-3">
            {/* Left: org name + status */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {thread.orgName}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-none ${STATUS_CLASS[thread.status] ?? STATUS_CLASS.sent}`}
                >
                  {STATUS_LABEL[thread.status] ?? thread.status}
                </span>
                {thread.replyIntent && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {INTENT_LABEL[thread.replyIntent] ?? thread.replyIntent}
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
      ))}
    </div>
  );
}
