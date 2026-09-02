"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Archive,
  Trash2,
  Mail,
  Star,
  Printer,
  ExternalLink,
  ChevronDown,
  Reply,
  Sparkles,
  Paperclip,
  Download,
  Send,
  MoreVertical,
  Building2,
  UserRound,
  FileSpreadsheet,
  FileText,
  FileCode,
} from "lucide-react";
import {
  type MockThread,
  type MockEmailMessage,
  type MockAttachment,
  formatFileSize,
} from "@/lib/inbox-mock-data";

export type GmailReadingPaneProps = {
  thread: MockThread;
  onBack: () => void;
  onToggleStar: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onArchive: (threadId: string) => void;
  onMarkUnread: (threadId: string) => void;
  onSendReply?: (threadId: string, replyBody: string) => void;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "U";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
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
  return colors[Math.abs(hash) % colors.length];
}

function AttachmentCard({ attachment }: { attachment: MockAttachment }) {
  const isPdf = attachment.fileType === "pdf";
  const isSheet = attachment.fileType === "xlsx";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 transition-all hover:bg-slate-100 hover:shadow-xs group max-w-xs">
      <div className={`p-2 rounded-md ${isPdf ? "bg-red-100 text-red-700" : isSheet ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
        {isPdf ? <FileText className="h-5 w-5" /> : isSheet ? <FileSpreadsheet className="h-5 w-5" /> : <FileCode className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-800" title={attachment.filename}>
          {attachment.filename}
        </p>
        <p className="text-[11px] text-slate-500">{formatFileSize(attachment.sizeBytes)}</p>
      </div>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          alert(`Downloading ${attachment.filename}`);
        }}
        title="Download"
        className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

function SingleMessageCard({
  message,
  isCollapsedByDefault,
}: {
  message: MockEmailMessage;
  isLatest?: boolean;
  isCollapsedByDefault: boolean;
}) {
  const [collapsed, setCollapsed] = useState(isCollapsedByDefault);
  const [showDetails, setShowDetails] = useState(false);

  const initials = getInitials(message.senderName);
  const avatarBg = getAvatarBg(message.senderName);

  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        className="flex items-center justify-between border-b border-slate-100 py-3 px-4 bg-slate-50/50 hover:bg-slate-100 cursor-pointer rounded-lg transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${avatarBg}`}>
            {initials}
          </div>
          <span className="font-semibold text-xs text-slate-800 truncate">{message.senderName}</span>
          <span className="text-xs text-slate-500 truncate max-w-md">{message.body.slice(0, 100)}...</span>
        </div>
        <span className="text-xs text-slate-400 shrink-0">
          {new Date(message.sentAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-5 transition-all ${
      message.isFromClient ? "border-emerald-200/80 bg-emerald-50/20" : "border-slate-200 bg-white"
    }`}>
      {/* Sender Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-xs ${avatarBg}`}>
            {initials}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-900">{message.senderName}</span>
              <span className="text-xs text-slate-500">&lt;{message.senderEmail}&gt;</span>
              {message.isFromClient && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  Client
                </span>
              )}
            </div>

            <div className="relative mt-0.5">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 font-medium"
              >
                <span>to {message.recipientName}</span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {showDetails && (
                <div className="absolute left-0 top-full mt-1 z-20 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-xs space-y-1.5 text-slate-600">
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-400 w-14">From:</span>
                    <span className="text-slate-800">{message.senderName} &lt;{message.senderEmail}&gt;</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-400 w-14">To:</span>
                    <span className="text-slate-800">{message.recipientName} &lt;{message.recipientEmail}&gt;</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-400 w-14">Date:</span>
                    <span className="text-slate-800">{new Date(message.sentAt).toLocaleString("en-GB")}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-400 w-14">Subject:</span>
                    <span className="text-slate-800">{message.subject}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Timestamp & Quick Message Actions */}
        <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
          <span>{new Date(message.sentAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })} ({new Date(message.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})</span>
          <button
            type="button"
            title="Reply"
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
          >
            <Reply className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="More options"
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Message Body */}
      <div className="mt-4 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap font-sans">
        {message.body}
      </div>

      {/* Attachments Section */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-5 border-t border-slate-200/80 pt-4">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 mb-2.5">
            <Paperclip className="h-3.5 w-3.5" />
            <span>{message.attachments.length} Attachment{message.attachments.length > 1 ? "s" : ""}</span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {message.attachments.map((att) => (
              <AttachmentCard key={att.id} attachment={att} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function GmailReadingPane({
  thread,
  onBack,
  onToggleStar,
  onDelete,
  onArchive,
  onMarkUnread,
  onSendReply,
}: GmailReadingPaneProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  function handleAiDraft() {
    setIsAiGenerating(true);
    setTimeout(() => {
      setReplyText(
        `Dear ${thread.primaryContact.name},\n\nThank you so much for your positive response! We are thrilled to collaborate with ${thread.orgName} on this pro-bono consulting engagement.\n\nOur project lead and senior mentor are available this Thursday at 2:00 PM or Friday at 11:00 AM for the discovery scoping session. Please let us know which time suits your calendar best.\n\nLooking forward to speaking soon!\n\nWarm regards,\n${thread.camOwner.name}\nClient Account Manager | 180 Degrees Consulting`
      );
      setIsAiGenerating(false);
      setReplyOpen(true);
    }, 600);
  }

  function handleSend() {
    if (!replyText.trim()) return;
    if (onSendReply) {
      onSendReply(thread.id, replyText);
    }
    setReplyText("");
    setReplyOpen(false);
  }

  const messages = thread.messages;

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Top Action Header (Gmail Style) */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-slate-600 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBack}
            title="Back to inbox"
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-700 hover:text-slate-900 mr-2 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onArchive(thread.id)}
            title="Archive"
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <Archive className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onDelete(thread.id)}
            title="Delete"
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-600 hover:text-red-600 cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onMarkUnread(thread.id)}
            title="Mark as unread"
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <Mail className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onToggleStar(thread.id)}
            title={thread.isStarred ? "Starred" : "Star"}
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-600 hover:text-amber-500 cursor-pointer"
          >
            <Star
              className={`h-4 w-4 ${
                thread.isStarred ? "fill-amber-400 text-amber-500" : "text-slate-400"
              }`}
            />
          </button>
        </div>

        {/* Right Action Icons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => window.print()}
            title="Print thread"
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <Printer className="h-4 w-4" />
          </button>

          <Link
            href={`/clients/${thread.id}`}
            title="Open client record"
            className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 px-2.5 py-1 rounded-md transition-colors"
          >
            <span>Client Record</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Main Conversation Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Thread Headline & Tags */}
        <div className="space-y-2 border-b border-slate-100 pb-4">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-xl font-bold text-slate-900 leading-snug">
              {thread.subject}
            </h1>
            <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {thread.sector}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Building2 className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-semibold text-slate-700">{thread.orgName}</span>
            <span>·</span>
            <UserRound className="h-3.5 w-3.5 text-slate-400" />
            <span>CAM: {thread.camOwner.name}</span>
          </div>
        </div>

        {/* Messages Stream */}
        <div className="space-y-4">
          {messages.map((msg, idx) => {
            const isLatest = idx === messages.length - 1;
            const isCollapsed = messages.length > 2 && idx < messages.length - 2;

            return (
              <SingleMessageCard
                key={msg.id}
                message={msg}
                isLatest={isLatest}
                isCollapsedByDefault={isCollapsed}
              />
            );
          })}
        </div>

        {/* Quick Reply Box (Gmail Composer Style) */}
        <div className="pt-4">
          {!replyOpen ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setReplyOpen(true)}
                className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:border-slate-400 transition-all cursor-pointer"
              >
                <Reply className="h-4 w-4" />
                <span>Reply to {thread.primaryContact.name}</span>
              </button>

              <button
                type="button"
                onClick={handleAiDraft}
                disabled={isAiGenerating}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-xs hover:from-emerald-700 hover:to-teal-700 transition-all cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                <span>{isAiGenerating ? "Generating draft…" : "✨ AI Generate Reply"}</span>
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-blue-200 bg-white shadow-md p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500 border-b border-slate-100 pb-2">
                <span>Replying to: <strong>{thread.primaryContact.name}</strong> &lt;{thread.primaryContact.email}&gt;</span>
                <button
                  type="button"
                  onClick={handleAiDraft}
                  className="flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>AI Polish</span>
                </button>
              </div>

              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply here..."
                rows={6}
                className="w-full text-sm text-slate-900 placeholder:text-slate-400 border-0 focus:ring-0 focus:outline-none resize-y"
              />

              {/* Bottom formatting & send bar */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSend}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all cursor-pointer"
                  >
                    <span>Send</span>
                    <Send className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => alert("Attachments can be dropped here.")}
                    className="p-2 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                    title="Attach file"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setReplyText("");
                    setReplyOpen(false);
                  }}
                  title="Discard draft"
                  className="p-2 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
