"use client";

import {
  Star,
  Bookmark,
  Paperclip,
  Archive,
  Trash2,
  Mail,
  MailOpen,
  Clock,
} from "lucide-react";
import { type MockThread, formatGmailTimestamp } from "@/lib/inbox-mock-data";

export type GmailThreadRowProps = {
  thread: MockThread;
  isSelected: boolean;
  isActive: boolean;
  onSelect: (threadId: string, e: React.MouseEvent | React.ChangeEvent) => void;
  onOpen: (thread: MockThread) => void;
  onToggleStar: (threadId: string, e: React.MouseEvent) => void;
  onToggleImportant: (threadId: string, e: React.MouseEvent) => void;
  onArchive: (threadId: string, e: React.MouseEvent) => void;
  onDelete: (threadId: string, e: React.MouseEvent) => void;
  onToggleRead: (threadId: string, e: React.MouseEvent) => void;
  onSnooze: (threadId: string, e: React.MouseEvent) => void;
};

const INTENT_BADGES: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  interested: {
    label: "Interested",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  meeting_booked: {
    label: "Meeting Booked",
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
  },
  more_info: {
    label: "More Info Requested",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  referral: {
    label: "Referral",
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
  },
};

export function GmailThreadRow({
  thread,
  isSelected,
  isActive,
  onSelect,
  onOpen,
  onToggleStar,
  onToggleImportant,
  onArchive,
  onDelete,
  onToggleRead,
  onSnooze,
}: GmailThreadRowProps) {
  const isUnread = !thread.isRead;
  const intentInfo = thread.replyIntent ? INTENT_BADGES[thread.replyIntent] : null;

  return (
    <div
      onClick={() => onOpen(thread)}
      className={`group relative flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm transition-colors cursor-pointer select-none ${
        isActive
          ? "bg-[#e8f0fe] border-l-4 border-l-blue-600"
          : isSelected
            ? "bg-[#c2e7ff]/30"
            : isUnread
              ? "bg-white font-semibold text-slate-900 shadow-xs"
              : "bg-slate-50/50 text-slate-700 hover:bg-slate-100/70"
      }`}
    >
      {/* Left Selection & Flag Actions */}
      <div
        className="flex items-center gap-1.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Checkbox */}
        <input
          type="checkbox"
          aria-label={`Select thread from ${thread.orgName}`}
          checked={isSelected}
          onChange={(e) => onSelect(thread.id, e)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />

        {/* Star */}
        <button
          type="button"
          onClick={(e) => onToggleStar(thread.id, e)}
          title={thread.isStarred ? "Starred" : "Not starred"}
          className="p-1 rounded-full hover:bg-slate-200/60 text-slate-400 transition-colors cursor-pointer"
        >
          <Star
            className={`h-4 w-4 ${
              thread.isStarred
                ? "fill-amber-400 text-amber-500"
                : "text-slate-300 hover:text-slate-500"
            }`}
          />
        </button>

        {/* Important Bookmark */}
        <button
          type="button"
          onClick={(e) => onToggleImportant(thread.id, e)}
          title={thread.isImportant ? "Important" : "Mark as important"}
          className="p-1 rounded-full hover:bg-slate-200/60 text-slate-400 transition-colors cursor-pointer hidden sm:inline-block"
        >
          <Bookmark
            className={`h-4 w-4 ${
              thread.isImportant
                ? "fill-amber-500 text-amber-600"
                : "text-slate-300 hover:text-slate-500"
            }`}
          />
        </button>
      </div>

      {/* Sender / Organisation Column */}
      <div className="w-48 shrink-0 min-w-0 flex items-center gap-2">
        <span
          className={`truncate ${
            isUnread ? "font-bold text-slate-900" : "font-medium text-slate-700"
          }`}
        >
          {thread.orgName}
        </span>
        {thread.messages.length > 1 && (
          <span className="text-[11px] text-slate-400 shrink-0">
            ({thread.messages.length})
          </span>
        )}
      </div>

      {/* Subject & Snippet Preview */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span
          className={`truncate text-sm ${
            isUnread ? "font-semibold text-slate-900" : "text-slate-800"
          }`}
        >
          {thread.subject}
        </span>
        <span className="text-slate-400 shrink-0">-</span>
        <span className="truncate text-xs text-slate-500 font-normal">
          {thread.snippet}
        </span>
      </div>

      {/* Badges / Indicators */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Intent Badge */}
        {intentInfo && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-tight ${intentInfo.bg} ${intentInfo.text} ${intentInfo.border}`}
          >
            {intentInfo.label}
          </span>
        )}

        {/* Sector Tag */}
        <span className="hidden md:inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
          {thread.sector}
        </span>

        {/* Attachment Indicator */}
        {thread.attachments && thread.attachments.length > 0 && (
          <div
            title={`${thread.attachments.length} attachment(s)`}
            className="flex items-center gap-0.5 text-slate-400 p-1"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      {/* Timestamp & Hover Quick Action Buttons */}
      <div
        className="w-28 shrink-0 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Normal state: Date / Time */}
        <div className="group-hover:hidden text-xs text-slate-500 font-medium">
          {formatGmailTimestamp(thread.lastActivityAt)}
        </div>

        {/* Hover Quick Actions */}
        <div className="hidden group-hover:flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(e) => onArchive(thread.id, e)}
            title="Archive"
            className="p-1 rounded-full hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => onDelete(thread.id, e)}
            title="Delete"
            className="p-1 rounded-full hover:bg-slate-200 text-slate-600 hover:text-red-600 transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => onToggleRead(thread.id, e)}
            title={thread.isRead ? "Mark as unread" : "Mark as read"}
            className="p-1 rounded-full hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            {thread.isRead ? (
              <Mail className="h-3.5 w-3.5" />
            ) : (
              <MailOpen className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => onSnooze(thread.id, e)}
            title="Snooze"
            className="p-1 rounded-full hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
