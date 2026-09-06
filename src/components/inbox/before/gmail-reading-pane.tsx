"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
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
  StickyNote,
  Plus,
  X,
} from "lucide-react";
import {
  type MockThread,
  type MockEmailMessage,
  type MockAttachment,
  formatFileSize,
} from "@/lib/inbox-mock-data";
import {
  getSectorColor,
  getSectorTagStyle,
} from "./gmail-sidebar";

export type GmailReadingPaneProps = {
  thread: MockThread;
  onBack: () => void;
  onToggleStar: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onMarkUnread: (threadId: string) => void;
  onSendReply?: (threadId: string, replyBody: string) => void;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "U";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

/** A CAM note against the client behind this thread. Mock-only — the inbox
    preview has no notes store, so these live in component state. */
type ClientNote = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })} · ${d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}`;
}

/** Fills the panel with `thread.notesCount` plausible notes so the feature can
    be seen without a backing table. Deterministic per thread. */
function seedNotes(thread: MockThread): ClientNote[] {
  const bodies = [
    `Left a voicemail for ${thread.primaryContact.name}. Follow up Thursday if no reply.`,
    `${thread.orgName} confirmed budget sign-off sits with their trustees — expect a 2–3 week turnaround.`,
    "Scoping call went well. They want help with fundraising strategy and volunteer operations.",
    "Sent the engagement letter. Awaiting countersignature.",
    `Flagged to ${thread.camOwner.name}: another 180DC branch may already be engaged here — check before proceeding.`,
  ];
  const count = Math.min(Math.max(thread.notesCount ?? 0, 0), bodies.length);
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    id: `${thread.id}-note-${i}`,
    author: thread.camOwner.name,
    body: bodies[i],
    createdAt: new Date(now - (i + 1) * 37 * 60 * 60 * 1000).toISOString(),
  }));
}

/** One header-icon button in the reading pane's top bar. */
const HEADER_BTN =
  "flex h-8 w-8 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink cursor-pointer";

function AttachmentCard({ attachment }: { attachment: MockAttachment }) {
  const isPdf = attachment.fileType === "pdf";
  const isSheet = attachment.fileType === "xlsx";
  const Icon = isPdf ? FileText : isSheet ? FileSpreadsheet : FileCode;

  return (
    <div className="group flex max-w-xs items-center gap-3 rounded-inset border border-rule-soft bg-paper p-2.5 transition-colors hover:border-rule">
      <Icon className="h-5 w-5 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink" title={attachment.filename}>
          {attachment.filename}
        </p>
        <p className="text-[12px] text-dim">{formatFileSize(attachment.sizeBytes)}</p>
      </div>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          alert(`Downloading ${attachment.filename}`);
        }}
        title="Download"
        className="flex h-7 w-7 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper-sunk hover:text-ink"
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

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center justify-between gap-3 rounded-inset border border-rule-soft bg-paper px-4 py-3 text-left transition-colors hover:bg-paper-sunk"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lead text-[11px] font-semibold text-white">
            {initials}
          </div>
          <span className="shrink-0 text-[13px] font-semibold text-ink">
            {message.senderName}
          </span>
          <span className="truncate text-[13px] text-dim">
            {message.body.slice(0, 100)}…
          </span>
        </div>
        <span className="shrink-0 text-[12px] text-faint">
          {new Date(message.sentAt).toLocaleTimeString("en-GB", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </button>
    );
  }

  return (
    <div
      className={`rounded-panel border p-5 ${
        message.isFromClient ? "border-rule bg-white" : "border-rule-soft bg-paper"
      }`}
    >
      {/* Sender header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lead text-[13px] font-semibold text-white">
            {initials}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{message.senderName}</span>
              <span className="text-[12px] text-faint">&lt;{message.senderEmail}&gt;</span>
              {message.isFromClient && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-go-wash px-2.5 py-1 text-[11px] leading-none font-semibold text-go">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  Client
                </span>
              )}
            </div>

            <div className="relative mt-1">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-[13px] font-medium text-dim transition-colors hover:text-ink"
              >
                <span>to {message.recipientName}</span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {showDetails && (
                <div className="absolute left-0 top-full z-20 mt-1 w-80 space-y-1.5 rounded-inset border border-rule bg-white p-3 text-[13px] text-dim shadow-[0_18px_40px_-18px_rgba(15,23,42,0.4)]">
                  {[
                    ["From", `${message.senderName} <${message.senderEmail}>`],
                    ["To", `${message.recipientName} <${message.recipientEmail}>`],
                    ["Date", new Date(message.sentAt).toLocaleString("en-GB")],
                    ["Subject", message.subject],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-2">
                      <span className="w-14 shrink-0 font-medium text-faint">{label}:</span>
                      <span className="text-ink">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Timestamp & per-message actions */}
        <div className="flex shrink-0 items-center gap-1 text-[12px] text-faint">
          <span className="mr-1">
            {new Date(message.sentAt).toLocaleTimeString("en-GB", {
              hour: "numeric",
              minute: "2-digit",
            })}
            {" · "}
            {new Date(message.sentAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
          </span>
          <button
            type="button"
            title="Reply"
            className="flex h-7 w-7 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink"
          >
            <Reply className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="More options"
            className="flex h-7 w-7 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="mt-4 text-sm leading-[1.65] text-ink whitespace-pre-wrap font-body">
        {message.body}
      </div>

      {/* Attachments */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-5 border-t border-rule-soft pt-4">
          <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-dim">
            <Paperclip className="h-3.5 w-3.5 text-faint" />
            <span>
              {message.attachments.length} attachment
              {message.attachments.length > 1 ? "s" : ""}
            </span>
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
  onMarkUnread,
  onSendReply,
}: GmailReadingPaneProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<ClientNote[]>(() => seedNotes(thread));
  const [draftNote, setDraftNote] = useState("");

  // The pane instance is reused as the reader moves between threads — reseed the
  // notes and drop any open sheet / half-typed note when the client changes.
  // Adjusting state during render (React's documented pattern) rather than in an
  // effect, so there is no extra commit with stale notes on screen.
  const [seededFor, setSeededFor] = useState(thread.id);
  if (seededFor !== thread.id) {
    setSeededFor(thread.id);
    setNotes(seedNotes(thread));
    setNotesOpen(false);
    setDraftNote("");
  }

  function handleAddNote() {
    const body = draftNote.trim();
    if (!body) return;
    setNotes((prev) => [
      {
        id: `${thread.id}-note-${Date.now()}`,
        author: thread.camOwner.name,
        body,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setDraftNote("");
  }

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
    <div className="relative flex h-full flex-col overflow-hidden bg-white">
      {/* Top action header */}
      <div className="flex shrink-0 items-center justify-between border-b border-rule-soft px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            title="Back to inbox"
            className={`${HEADER_BTN} mr-1`}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(thread.id)}
            title="Delete"
            className={`${HEADER_BTN} hover:text-stop`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMarkUnread(thread.id)}
            title="Mark as unread"
            className={HEADER_BTN}
          >
            <Mail className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggleStar(thread.id)}
            title={thread.isStarred ? "Starred" : "Star"}
            className={HEADER_BTN}
          >
            <Star
              className={`h-4 w-4 ${
                thread.isStarred ? "fill-amber-400 text-amber-500" : ""
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => window.print()}
            title="Print thread"
            className={HEADER_BTN}
          >
            <Printer className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            title="Client notes"
            className="flex items-center gap-1.5 rounded-inset px-2.5 py-1 text-[13px] font-semibold text-dim transition-colors hover:bg-paper hover:text-ink"
          >
            <StickyNote className="h-3.5 w-3.5" />
            <span>Notes</span>
            {notes.length > 0 && (
              <span className="font-mono text-[10.5px] tabular-nums text-faint">
                {notes.length}
              </span>
            )}
          </button>
          <Link
            href={`/clients/${thread.id}`}
            title="Open client record"
            className="flex items-center gap-1.5 rounded-inset px-2.5 py-1 text-[13px] font-semibold text-lead transition-colors hover:bg-lead-wash"
          >
            <span>Client record</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 space-y-5 overflow-y-auto px-8 py-6">
        {/* Headline */}
        <div className="space-y-2 border-b border-rule-soft pb-4">
          <div className="flex items-start justify-between gap-4">
            <h1 className="font-body text-[22px] font-semibold leading-snug tracking-[-0.01em] text-ink">
              {thread.subject}
            </h1>
            <span
              style={getSectorTagStyle(
                getSectorColor(thread.sector, thread.labelColor),
                false,
              )}
              className="shrink-0 py-1 pl-3 pr-4 text-xs font-semibold"
            >
              {thread.sector}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[13px] text-dim">
            <Building2 className="h-[15px] w-[15px] text-faint" />
            <span className="font-medium text-ink">{thread.orgName}</span>
            <span className="text-faint">·</span>
            <UserRound className="h-[15px] w-[15px] text-faint" />
            <span>CAM: {thread.camOwner.name}</span>
          </div>
        </div>

        {/* Messages */}
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

        {/* Reply */}
        <div className="pt-4">
          {!replyOpen ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setReplyOpen(true)}
                className="flex items-center gap-2 rounded-inset bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90 cursor-pointer"
              >
                <Reply className="h-4 w-4" />
                <span>Reply to {thread.primaryContact.name}</span>
              </button>

              <button
                type="button"
                onClick={handleAiDraft}
                disabled={isAiGenerating}
                className="flex items-center gap-2 rounded-inset border border-rule bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paper disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="h-4 w-4 text-lead" />
                <span>{isAiGenerating ? "Drafting reply…" : "AI draft reply"}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 rounded-panel border border-rule bg-white p-4">
              <div className="flex items-center justify-between border-b border-rule-soft pb-2 text-[12px] text-dim">
                <span>
                  Replying to <span className="font-semibold text-ink">{thread.primaryContact.name}</span>{" "}
                  &lt;{thread.primaryContact.email}&gt;
                </span>
                <button
                  type="button"
                  onClick={handleAiDraft}
                  className="flex items-center gap-1 font-semibold text-lead transition-colors hover:text-lead/80"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>AI polish</span>
                </button>
              </div>

              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply here…"
                rows={6}
                spellCheck
                className="w-full resize-y border-0 text-sm leading-[1.65] text-ink placeholder:text-faint focus:outline-none focus:ring-0"
              />

              <div className="flex items-center justify-between border-t border-rule-soft pt-3">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSend}
                    className="flex items-center gap-2 rounded-inset bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90 cursor-pointer"
                  >
                    <span>Send</span>
                    <Send className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => alert("Attachments can be dropped here.")}
                    className="flex h-8 w-8 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink"
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
                  className="flex h-8 w-8 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-stop"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Client notes — slides over the conversation rather than replacing it,
          so the thread underneath is never lost. Mock-only: state lives in this
          component, nothing is persisted. */}
      <AnimatePresence>
        {notesOpen && (
          <motion.div
            key="client-notes"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-30 flex flex-col bg-white"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-rule-soft px-4 py-2.5">
              <button
                type="button"
                onClick={() => setNotesOpen(false)}
                title="Back to the thread"
                className={HEADER_BTN}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <StickyNote className="h-4 w-4 text-faint" />
                Notes · {thread.orgName}
              </span>
              <button
                type="button"
                onClick={() => setNotesOpen(false)}
                title="Close"
                className={`${HEADER_BTN} ml-auto`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Add a note */}
            <div className="shrink-0 border-b border-rule-soft px-6 py-4">
              <textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleAddNote();
                  }
                }}
                placeholder="Add a note about this client…"
                rows={3}
                spellCheck
                className="w-full resize-y rounded-inset border border-rule bg-paper px-3 py-2 text-[13px] leading-[1.6] text-ink placeholder:text-faint focus:border-lead focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-faint">⌘↵ to save</span>
                <button
                  type="button"
                  onClick={handleAddNote}
                  disabled={!draftNote.trim()}
                  className="flex items-center gap-1.5 rounded-inset bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add note
                </button>
              </div>
            </div>

            {/* Notes list */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {notes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <StickyNote className="mb-3 h-10 w-10 text-faint stroke-[1.5]" />
                  <p className="text-[13px] font-semibold text-ink">No notes yet</p>
                  <p className="mt-1 text-[12px] text-dim">
                    Add the first note about {thread.orgName} above.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {notes.map((note) => (
                    <li
                      key={note.id}
                      className="rounded-panel border border-rule-soft bg-paper p-4"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lead text-[10px] font-semibold text-white">
                          {getInitials(note.author)}
                        </div>
                        <span className="text-[12px] font-semibold text-ink">
                          {note.author}
                        </span>
                        <span className="text-[11px] text-faint">
                          {formatNoteDate(note.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-[13px] leading-[1.6] text-ink whitespace-pre-wrap">
                        {note.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
