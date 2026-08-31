/**
 * Gmail-style conversation view — the full past of one outreach thread:
 * every sent email and every client reply, interleaved chronologically
 * (oldest first, like reading an email thread top-down).
 *
 * Purely presentational (no data fetching) so the live route
 * (/inbox/[orgId]) and the preview page drive it identically — same split as
 * ThreadList. Read-only by design (PRD §12.1): generating/sending happens via
 * the approved send path on the client page, never from this view.
 *
 * Server-compatible (no "use client"): formatExactTime is deterministic per
 * clock, and rendering happens on the server — see display-format.ts's
 * hydration note.
 */

import type { ConversationEntry } from "@/lib/outreach-inbox";
import { formatExactTime } from "@/lib/display-format";

const TYPE_LABEL: Record<ConversationEntry["type"], string> = {
  email_sent: "Email sent",
  reply_received: "Reply from the client",
};

export function ConversationView({ entries }: { entries: ConversationEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center text-sm text-muted-foreground">
        No messages in this thread yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const isReply = entry.type === "reply_received";
        return (
          <div
            key={entry.id}
            className={`rounded-lg border p-4 ${
              isReply
                ? "border-emerald-200 bg-emerald-50/[0.5]"
                : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-none ${
                  isReply
                    ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                    : "border-gray-200 bg-gray-100 text-gray-500"
                }`}
              >
                {TYPE_LABEL[entry.type]}
              </span>
              <span className="text-[11px] text-muted-foreground">{entry.actorName}</span>
              <span className="text-[11px] text-muted-foreground">·</span>
              <span className="text-[11px] text-muted-foreground">
                {formatExactTime(new Date(entry.timestamp))}
              </span>
            </div>
            {entry.subject && (
              <p className="mt-2 text-sm font-semibold text-foreground">{entry.subject}</p>
            )}
            <p className="mt-2 whitespace-pre-wrap text-sm leading-[1.65] text-foreground/85">
              {entry.body}
            </p>
          </div>
        );
      })}
    </div>
  );
}
