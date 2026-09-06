/**
 * One outreach thread's whole past: every sent email and every client reply,
 * interleaved oldest-first, the way an email thread is read top-down.
 *
 * Converted to the filed-record language (docs/app-design-system.md). Two
 * things went with the old version and both were carrying meaning they had not
 * earned:
 *
 * - **The seven-colour avatar.** A hash of the sender's name picked from
 *   `bg-emerald-600 … bg-rose-600` — Tailwind ramp colours, outside the system,
 *   and a colour that means nothing at all. Who sent a message is already said
 *   in words on the next line.
 * - **A green card for every reply.** Colour in this system reports a state,
 *   and "this message came from them" is a direction, not a state. Direction is
 *   now carried by the side rule and the label, which survive greyscale.
 */

import { Pill } from "@/app/clients/[id]/section-card";
import { formatExactTime } from "@/lib/display-format";
import { intentLabel } from "@/lib/inbox-labels";
import type { ConversationEntry } from "@/lib/outreach-inbox";

const TYPE_LABEL: Record<ConversationEntry["type"], string> = {
  email_sent: "Email sent",
  reply_received: "Reply from client",
};

/** How many of the newest messages stay open by default. */
const EXPANDED_COUNT = 3;

function MessageCard({ entry }: { entry: ConversationEntry }) {
  const isReply = entry.type === "reply_received";

  return (
    <article
      className={`rounded-panel border border-rule bg-white px-5 py-4 ${
        // A reply is the half of the thread we did not write. The rule marks it
        // down the left edge rather than tinting the whole card.
        isReply ? "border-l-[3px] border-l-go" : ""
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-ink">
            {entry.actorName}
          </span>
          <Pill tone={isReply ? "go" : "neutral"} dot={false}>
            {TYPE_LABEL[entry.type]}
          </Pill>
          {entry.intent && (
            <Pill tone="lead" dot={false}>
              {intentLabel(entry.intent)}
            </Pill>
          )}
        </div>
        <p className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
          {formatExactTime(new Date(entry.timestamp))}
        </p>
      </div>

      {entry.subject && (
        <p className="mt-3 border-b border-rule-soft pb-2 text-sm font-semibold text-ink">
          {entry.subject}
        </p>
      )}

      <div className="mt-3 text-sm leading-[1.65] whitespace-pre-wrap text-ink">
        {entry.body}
      </div>
    </article>
  );
}

export function ConversationView({ entries }: { entries: ConversationEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-panel border border-rule bg-white px-6 py-12 text-center">
        <p className="text-sm font-semibold text-ink">No messages yet</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-[13px] leading-[1.55] text-dim">
          Nothing has been sent to this client, and nothing has come back.
        </p>
      </div>
    );
  }

  const foldedCount = Math.max(0, entries.length - EXPANDED_COUNT);
  const folded = entries.slice(0, foldedCount);
  const open = entries.slice(foldedCount);

  return (
    <div className="space-y-3">
      {folded.length > 0 && (
        <details className="group rounded-panel border border-rule bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] text-dim transition-colors hover:text-ink">
            <span>
              {folded.length} earlier message{folded.length === 1 ? "" : "s"}
            </span>
            <span className="font-semibold text-lead group-open:hidden">Show earlier</span>
            <span className="hidden font-semibold text-dim group-open:inline">Hide</span>
          </summary>
          <div className="space-y-3 border-t border-rule-soft bg-paper/60 p-3">
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
