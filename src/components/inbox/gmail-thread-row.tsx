"use client";

import { useMemo } from "react";
import {
  Star,
  Paperclip,
  Trash2,
  Mail,
  MailOpen,
  CalendarClock,
} from "lucide-react";
import {
  type InboxThreadView,
  formatGmailTimestamp,
  formatScheduledShort,
} from "@/lib/inbox-thread-view";
import {
  getSectorColor,
  getSectorTagStyle,
} from "./gmail-sidebar";

export type GmailThreadRowProps = {
  thread: InboxThreadView;
  isSelected: boolean;
  hasSelection?: boolean;
  isActive: boolean;
  isSentView?: boolean;
  /** Scheduled folder: the right column shows when the send is due, not a
      "sent X ago" relative time. */
  isScheduledView?: boolean;
  /** Real URL for this thread, so the row is a genuine link — right-click /
      ⌘-click / middle-click open it in a new tab the way any anchor does. A
      plain left click is intercepted and handled in-app. */
  href: string;
  onSelect: (threadId: string, e: React.MouseEvent | React.ChangeEvent) => void;
  onOpen: (thread: InboxThreadView) => void;
  onToggleStar: (threadId: string, e: React.MouseEvent) => void;
  onDelete: (threadId: string, e: React.MouseEvent) => void;
  onToggleRead: (threadId: string, e: React.MouseEvent) => void;
  onToggleSector?: (sector: string, e: React.MouseEvent) => void;
  isSectorActive?: boolean;
  sectorBg?: string;
};

export function GmailThreadRow({
  thread,
  isSelected,
  hasSelection = false,
  isActive,
  isSentView = false,
  isScheduledView = false,
  href,
  onSelect,
  onOpen,
  onToggleStar,
  onDelete,
  onToggleRead,
  onToggleSector,
  isSectorActive = false,
  sectorBg,
}: GmailThreadRowProps) {
  const isUnread = !thread.isRead;

  const showCheckbox = isSelected || hasSelection;
  const showStar = thread.isStarred || hasSelection;

  // In Sent view: display who we sent it to, and show the sent message body as the snippet
  const sentMessage = useMemo(() => {
    if (!isSentView) return null;
    return (
      [...thread.messages].reverse().find((m) => !m.isFromClient) ??
      thread.messages[0]
    );
  }, [thread.messages, isSentView]);

  const displayRecipient = isSentView
    ? `To: ${thread.primaryContact?.name || thread.orgName}`
    : thread.orgName;

  const displaySnippet = useMemo(() => {
    const activeMessage = isSentView
      ? sentMessage
      : [...thread.messages].reverse().find((m) => m.isFromClient) ??
        thread.messages[thread.messages.length - 1];

    const bodyText = activeMessage?.body?.replace(/\s+/g, " ").trim();
    if (bodyText && bodyText.length > thread.snippet.length) {
      return bodyText;
    }
    return thread.snippet;
  }, [thread.messages, thread.snippet, isSentView, sentMessage]);

  return (
    <div
      className={`group relative flex items-center gap-3 border-b border-rule-soft px-3 py-2.5 text-sm transition-colors cursor-pointer select-none ${
        isActive
          ? "bg-lead-wash border-l-2 border-l-lead"
          : isSelected
            ? "bg-lead-wash/50 hover:bg-lead-wash/70"
            : "bg-white hover:bg-paper"
      }`}
    >
      {/* The row itself is this link, stretched over the whole row behind the
          content. A modified click (⌘/Ctrl/Shift) or middle click falls through
          to the browser — new tab, new window, background tab — exactly like a
          normal anchor; a plain click is handled in-app. The real controls
          below sit at `z-20` so they stay clickable above it. */}
      <a
        href={href}
        aria-label={`Open thread from ${displayRecipient}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
            return;
          }
          e.preventDefault();
          onOpen(thread);
        }}
        className="absolute inset-0 z-10"
      />

      {/* Left Selection & Flag Actions */}
      <div
        className="relative z-20 flex items-center gap-1.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Checkbox */}
        <input
          type="checkbox"
          aria-label={
            isSentView
              ? `Select sent message to ${thread.primaryContact?.name || thread.orgName}`
              : `Select thread from ${thread.orgName}`
          }
          checked={isSelected}
          onChange={(e) => onSelect(thread.id, e)}
          className={`h-4 w-4 rounded border-rule text-lead focus:ring-lead cursor-pointer transition-opacity duration-150 ${
            showCheckbox
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        />

        {/* Star */}
        <button
          type="button"
          onClick={(e) => onToggleStar(thread.id, e)}
          title={thread.isStarred ? "Starred" : "Not starred"}
          className={`p-1 rounded-inset hover:bg-paper-sunk text-faint transition-opacity duration-150 cursor-pointer ${
            showStar
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <Star
            className={`h-4 w-4 ${
              thread.isStarred
                ? "fill-amber-400 text-amber-500"
                : "text-faint hover:text-dim"
            }`}
          />
        </button>
      </div>

      {/* Sender / Organisation Column */}
      <div className="w-48 shrink-0 min-w-0 flex items-center gap-2">
        <span
          className={`truncate font-body ${
            isUnread && !isSentView ? "font-semibold text-ink" : "font-medium text-dim"
          }`}
          title={displayRecipient}
        >
          {displayRecipient}
        </span>
        {thread.messages.length > 1 && (
          <span className="text-[11px] text-faint shrink-0">
            ({thread.messages.length})
          </span>
        )}
      </div>

      {/* Snippet Preview — content only, in the subject line's own type. */}
      <div className="flex-1 min-w-0 flex items-center">
        <span
          className={`truncate text-sm ${
            isUnread && !isSentView ? "font-medium text-ink" : "text-dim"
          }`}
        >
          {displaySnippet}
        </span>
      </div>

      {/* Badges / Indicators */}
      <div className="relative z-20 flex items-center gap-1.5 shrink-0">
        {/* Sector Tag */}
        {(() => {
          const sectorColor =
            sectorBg || getSectorColor(thread.sector, thread.labelColor);
          const sectorStyle = getSectorTagStyle(sectorColor, isSectorActive);

          return onToggleSector ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSector(thread.sector, e);
              }}
              title={
                isSectorActive
                  ? `Filtered by ${thread.sector} — click to remove filter`
                  : `Filter by ${thread.sector}`
              }
              style={sectorStyle}
              className={`hidden md:inline-flex items-center py-0.5 pl-2.5 pr-3.5 text-[10px] transition-all cursor-pointer ${
                isSectorActive
                  ? "font-semibold shadow-xs hover:brightness-110"
                  : "font-medium hover:brightness-90"
              }`}
            >
              {thread.sector}
            </button>
          ) : (
            <span
              style={sectorStyle}
              className={`hidden md:inline-flex items-center py-0.5 pl-2.5 pr-3.5 text-[10px] transition-colors ${
                isSectorActive ? "font-semibold shadow-xs" : "font-medium"
              }`}
            >
              {thread.sector}
            </span>
          );
        })()}

        {/* Tag chips (TAGS/ORG_TAGS) — the same labels the sidebar filters on.
            Capped at two so a heavily-tagged client does not push the
            timestamp off the row; the rest are a "+N". */}
        {thread.tags && thread.tags.length > 0 && (
          <div className="hidden lg:flex items-center gap-1">
            {thread.tags.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                title={tag.name}
                className="inline-flex max-w-[7rem] items-center truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: `color-mix(in srgb, ${tag.colour ?? "var(--lead)"} 14%, transparent)`,
                  color: tag.colour ?? "var(--lead)",
                }}
              >
                {tag.name}
              </span>
            ))}
            {thread.tags.length > 2 && (
              <span className="text-[10px] font-medium text-faint">
                +{thread.tags.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Attachment Indicator */}
        {thread.attachments && thread.attachments.length > 0 && (
          <div
            title={`${thread.attachments.length} attachment(s)`}
            className="flex items-center gap-0.5 text-faint p-1"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      {/* Timestamp & Hover Quick Action Buttons. A fixed min-height in the
          scheduled view: its label is two lines but the hover quick-actions are
          one, and without a floor the row would shrink a few px on hover. */}
      <div
        className={`relative z-20 flex shrink-0 flex-col items-end justify-center text-right ${
          isScheduledView ? "min-h-[34px] w-[108px]" : "w-[62px]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scheduled folder: say when it goes out, not how long ago it was
            "sent". Everywhere else: relative time ("25m ago") against
            Date.now(), so SSR and hydration can straddle a minute boundary —
            same reason site-chrome.tsx suppresses its own clock. */}
        {isScheduledView ? (
          <div className="group-hover:hidden flex flex-col items-end gap-0.5">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-hold">
              <CalendarClock className="h-3 w-3" />
              Scheduled for
            </span>
            <span
              className="text-xs font-medium text-ink"
              suppressHydrationWarning
            >
              {formatScheduledShort(thread.scheduledFor ?? thread.lastActivityAt)}
            </span>
          </div>
        ) : (
          <div
            className={`group-hover:hidden text-xs ${
              isUnread ? "font-semibold text-ink" : "text-faint font-medium"
            }`}
            suppressHydrationWarning
          >
            {formatGmailTimestamp(thread.lastActivityAt)}
          </div>
        )}

        {/* Hover Quick Actions */}
        <div className="hidden group-hover:flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(e) => onDelete(thread.id, e)}
            title="Delete"
            className="p-1 rounded-inset hover:bg-paper-sunk text-faint hover:text-stop transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => onToggleRead(thread.id, e)}
            title={thread.isRead ? "Mark as unread" : "Mark as read"}
            className="p-1 rounded-inset hover:bg-paper-sunk text-faint hover:text-ink transition-colors cursor-pointer"
          >
            {thread.isRead ? (
              <Mail className="h-3.5 w-3.5" />
            ) : (
              <MailOpen className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
