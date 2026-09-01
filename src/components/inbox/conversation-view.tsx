/**
 * Gmail-style conversation view — the full past of one outreach thread:
 * every sent email and every client reply, interleaved chronologically
 * (oldest first, like reading an email thread top-down).
 *
 * Purely presentational (no data fetching) so the live route
 * (/inbox/[orgId]) and the preview page drive it identically — same split as
 * ThreadList.
 *
 * Server-compatible (no "use client"): formatExactTime is deterministic per
 * clock, and rendering happens on the server — see display-format.ts's
 * hydration note. The "earlier messages" collapse is a native <details>
 * element for the same reason: it needs no JavaScript and no state, so this
 * component stays out of the client bundle.
 *
 * Replying is not this component's job — the route mounts ReplyDrawer beneath
 * it. (An earlier version of this note claimed PRD §12.1 forbade replying from
 * the inbox at all; it does not. §12.1 governs *how* outreach is sent — the
 * Gmail API on the CAM's own authorised account — and the drawer goes through
 * exactly that approved server-action path. Read-only was a v1 scope decision.)
 */

import type { ConversationEntry } from "@/lib/outreach-inbox";
import { intentLabel } from "@/lib/inbox-labels";
import { formatExactTime } from "@/lib/display-format";

const TYPE_LABEL: Record<ConversationEntry["type"], string> = {
  email_sent: "Email sent",
  reply_received: "Reply from the client",
};

/**
 * How many of the newest messages stay open. A long thread is read from the
 * bottom — the recent exchange is what a reply answers — so older messages
 * fold away rather than pushing it off the screen.
 */
const EXPANDED_COUNT = 3;

function MessageCard({ entry }: { entry: ConversationEntry }) {
  const isReply = entry.type === "reply_received";
  return (
    <div
      className={`rounded-lg border p-4 ${
        isReply ? "border-emerald-200 bg-emerald-50/[0.5]" : "border-gray-200 bg-white"
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
        {/* The classified intent is the one thing that tells you what this
            reply *wants* before you read it. Selected by the route already —
            it was simply never shown. */}
        {entry.intent && (
          <span className="shrink-0 rounded-full border border-emerald-300/60 bg-white px-2 py-0.5 text-[11px] leading-none text-emerald-800">
            {intentLabel(entry.intent)}
          </span>
        )}
      </div>
      {entry.subject && (
        <p className="mt-2 text-sm font-semibold text-foreground">{entry.subject}</p>
      )}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-[1.65] text-foreground/85">
        {entry.body}
      </p>
    </div>
  );
}

export function ConversationView({ entries }: { entries: ConversationEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center text-sm text-muted-foreground">
        No messages in this thread yet.
      </div>
    );
  }

  const foldedCount = Math.max(0, entries.length - EXPANDED_COUNT);
  const folded = entries.slice(0, foldedCount);
  const open = entries.slice(foldedCount);

  return (
    <div className="space-y-3">
      {folded.length > 0 && (
        <details className="group rounded-lg border border-dashed border-gray-200 bg-white/60">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground">
            {folded.length} earlier message{folded.length === 1 ? "" : "s"}
            <span className="ml-2 text-[11px] group-open:hidden">Show</span>
            <span className="ml-2 hidden text-[11px] group-open:inline">Hide</span>
          </summary>
          <div className="space-y-3 border-t border-dashed border-gray-200 p-3">
            {folded.map((entry) => (
              <MessageCard entry={entry} key={entry.id} />
            ))}
          </div>
        </details>
      )}
      {open.map((entry) => (
        <MessageCard entry={entry} key={entry.id} />
      ))}
    </div>
  );
}
