/**
 * Gmail-style conversation view — the full past of one outreach thread:
 * every sent email and every client reply, interleaved chronologically
 * (oldest first, like reading an email thread top-down).
 */

import type { ConversationEntry } from "@/lib/outreach-inbox";
import { intentLabel } from "@/lib/inbox-labels";
import { formatExactTime } from "@/lib/display-format";

const TYPE_LABEL: Record<ConversationEntry["type"], string> = {
  email_sent: "Email sent",
  reply_received: "Reply from client",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "U";
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

function getAvatarBg(name: string): string {
  const colors = [
    "bg-emerald-600",
    "bg-sky-600",
    "bg-indigo-600",
    "bg-purple-600",
    "bg-rose-600",
    "bg-amber-600",
    "bg-teal-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length] || "bg-slate-600";
}

/**
 * How many of the newest messages stay open by default.
 */
const EXPANDED_COUNT = 3;

function MessageCard({ entry }: { entry: ConversationEntry }) {
  const isReply = entry.type === "reply_received";
  const initials = getInitials(entry.actorName || "CAM");
  const avatarBg = getAvatarBg(entry.actorName || "User");

  return (
    <div
      className={`rounded-xl border p-5 shadow-xs transition-all ${
        isReply
          ? "border-emerald-200/90 bg-emerald-50/25"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-xs ${avatarBg}`}
          >
            {initials}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">{entry.actorName}</span>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none ${
                  isReply
                    ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                    : "border-slate-200 bg-slate-100 text-slate-600"
                }`}
              >
                {TYPE_LABEL[entry.type]}
              </span>
              {entry.intent && (
                <span className="shrink-0 rounded-full border border-emerald-300/80 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  {intentLabel(entry.intent)}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {formatExactTime(new Date(entry.timestamp))}
            </p>
          </div>
        </div>
      </div>

      {entry.subject && (
        <p className="mt-3 text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
          {entry.subject}
        </p>
      )}

      <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 font-sans">
        {entry.body}
      </div>
    </div>
  );
}

export function ConversationView({ entries }: { entries: ConversationEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500 bg-slate-50/50">
        No messages in this thread yet.
      </div>
    );
  }

  const foldedCount = Math.max(0, entries.length - EXPANDED_COUNT);
  const folded = entries.slice(0, foldedCount);
  const open = entries.slice(foldedCount);

  return (
    <div className="space-y-4">
      {folded.length > 0 && (
        <details className="group rounded-xl border border-dashed border-slate-200 bg-white/80 shadow-xs">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 flex items-center justify-between">
            <span>
              {folded.length} earlier message{folded.length === 1 ? "" : "s"}
            </span>
            <span className="text-xs text-blue-600 font-semibold group-open:hidden">
              Show earlier
            </span>
            <span className="hidden text-xs text-slate-500 group-open:inline">Hide</span>
          </summary>
          <div className="space-y-3 border-t border-dashed border-slate-200 p-3">
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
