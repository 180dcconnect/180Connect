"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Paperclip,
  Download,
  Copy,
  Check,
  Ban,
  MoreVertical,
  Building2,
  StickyNote,
  X,
  CalendarClock,
} from "lucide-react";
import {
  type InboxThreadView,
  type InboxEmailMessage,
  type InboxAttachmentView,
  formatFileSize,
  formatScheduledFor,
} from "@/lib/inbox-thread-view";
import {
  getSectorColor,
  getSectorTagStyle,
} from "./gmail-sidebar";
import { InboxAttachmentCard } from "./inbox-attachment-card";
import { ReplyComposer } from "@/components/outreach/reply-composer";
import { EmailReviewPanel } from "@/components/outreach/email-review-panel";
import { ScheduleSendDialog, formatScheduleLong } from "@/components/outreach/schedule-send-dialog";
import { ThreadNotesDrawer } from "./thread-notes-drawer";
import { ThreadOwnershipBanner } from "./thread-ownership-banner";
import type { AppRole } from "@/lib/auth/permissions";
import type { PendingSendRequest } from "./gmail-compose-modal";
import { emailHtmlToPlainText, isRichEmailHtml, sanitizeEmailHtml } from "@/lib/outreach/email-html";
import { StatusSelect } from "@/app/clients/[id]/status-select";
import { formatOutreachStatus } from "@/lib/organisation-format";

export type GmailReadingPaneProps = {
  thread: InboxThreadView;
  onBack: () => void;
  onToggleStar: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onMarkUnread: (threadId: string) => void;
  /**
   * Whether the viewer may move this client's pipeline status (owning CAM or
   * admin — the shell computes the same gate as the client record header).
   * Absent, the status renders read-only.
   */
  canSetStatus?: boolean;
  /**
   * Scheduled threads only. Resolves with an error message to show, or null
   * on success (the shell refreshes and moves on). Absent, the banner is
   * read-only.
   */
  onCancelScheduled?: (messageId: string) => Promise<string | null>;
  /** Same contract: moves the scheduled email to a new time, content untouched. */
  onRescheduleScheduled?: (messageId: string, when: Date) => Promise<string | null>;
  /**
   * The scheduled email was edited in place and saved. The shell refreshes so
   * the thread shows the saved content and time; the thread stays open.
   */
  onScheduledEdited?: () => void;
  /** Hands a prepared send to the shell for the delayed-commit Undo window. */
  onSend?: (request: PendingSendRequest) => void;
  /**
   * The viewer's user id and role. When both are present and someone else owns
   * the client, the Reply control is replaced by the ownership banner (admin:
   * change ownership; CAM: request it). Absent, Reply renders as before.
   */
  viewerId?: string | null;
  viewerRole?: AppRole | null;
  /** Ownership moved to the viewer from the banner; the shell refreshes. */
  onOwnershipChanged?: () => void;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "U";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

/** One header-icon button in the reading pane's top bar. */
const HEADER_BTN =
  "flex h-8 w-8 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink cursor-pointer";

function AttachmentCard({ attachment }: { attachment: InboxAttachmentView }) {
  return (
    <InboxAttachmentCard
      filename={attachment.filename}
      fileType={attachment.fileType}
      sizeLabel={formatFileSize(attachment.sizeBytes)}
      action={
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
      }
    />
  );
}

/** Confirm-and-reason dialog for flagging the thread's client as Do Not
    Contact. Posts to the same `/suppress` route the client record's suppress
    button uses — a CAM request an admin reviews before it takes effect. */
function SuppressClientDialog({
  orgName,
  organisationId,
  onClose,
}: {
  orgName: string;
  organisationId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  async function handleConfirm() {
    if (!reason.trim()) {
      setError("A reason is required before flagging as Do Not Contact.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/suppress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The client could not be suppressed.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-panel border border-rule bg-white p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suppress-dialog-title"
      >
        {done ? (
          <div className="text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-go-wash">
              <Check className="h-5 w-5 text-go" />
            </span>
            <h2 id="suppress-dialog-title" className="mt-3 text-[15px] font-semibold text-ink">
              Suppression requested
            </h2>
            <p className="mt-1 text-[13px] leading-[1.6] text-dim">
              {orgName} was flagged as Do Not Contact. An admin reviews the
              request before it takes effect.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Link
                href={`/clients/${organisationId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-inset bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-ink/90"
              >
                Open client record
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="rounded-inset px-4 py-2 text-[13px] font-semibold text-dim transition-colors hover:bg-paper hover:text-ink"
              >
                Back to thread
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 id="suppress-dialog-title" className="text-[15px] font-semibold text-ink">
              Suppress {orgName}?
            </h2>
            <p className="mt-1 text-[13px] leading-[1.6] text-dim">
              This flags the client as Do Not Contact and stops further
              outreach. An admin reviews the request before it takes effect.
            </p>
            <label
              className="mt-4 block text-[13px] font-medium text-dim"
              htmlFor="inbox-suppress-reason"
            >
              Reason
            </label>
            <textarea
              id="inbox-suppress-reason"
              className="mt-2 w-full resize-y rounded-inset border border-rule bg-white px-3 py-2 text-[13px] leading-[1.6] text-ink placeholder:text-faint focus:border-lead focus:outline-none"
              placeholder="e.g. hard no, legal request, unsubscribe. Required, and kept on file."
              disabled={busy}
              onChange={(event) => {
                setReason(event.target.value);
                if (error) setError(null);
              }}
              rows={3}
              value={reason}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => void handleConfirm()}
                className="rounded-inset border border-stop/30 px-4 py-2 text-[13px] font-semibold text-stop transition-colors hover:bg-stop-wash disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Flagging…" : "Flag as Do Not Contact"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="rounded-inset px-4 py-2 text-[13px] font-semibold text-dim transition-colors hover:bg-paper hover:text-ink"
              >
                Cancel
              </button>
            </div>
            {error && (
              <p className="mt-3 text-[13px] font-semibold text-stop" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SingleMessageCard({
  message,
  isCollapsedByDefault,
  onReply,
  onSuppressClient,
  forceExpanded = false,
}: {
  message: InboxEmailMessage;
  isLatest?: boolean;
  isCollapsedByDefault: boolean;
  /** Opens the thread reply composer answering this message. */
  onReply: (message: InboxEmailMessage) => void;
  /** Opens the pane-level suppress-client dialog. */
  onSuppressClient: () => void;
  /** Printing expands every message: a collapsed card would print its
      100-character snippet instead of the email body. */
  forceExpanded?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(isCollapsedByDefault);
  const [showDetails, setShowDetails] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFeedback, setMenuFeedback] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The ⋮ menu is a small floating sheet: Escape or a tap outside closes it.
  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [menuOpen]);

  const initials = getInitials(message.senderName);

  /** Gmail's "Download message": headers + body as .eml, built locally — no
      attachment bytes travel with it, so it never touches the network. */
  function downloadMessage() {
    const lines = [
      `From: ${message.senderName} <${message.senderEmail}>`,
      `To: ${message.recipientName} <${message.recipientEmail}>`,
      `Subject: ${message.subject}`,
      `Date: ${new Date(message.sentAt).toUTCString()}`,
      "Content-Type: text/plain; charset=utf-8",
      ...(message.attachments ?? []).map(
        (att) => `X-Attachment: ${att.filename}`,
      ),
      "",
      emailHtmlToPlainText(message.body),
      "",
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "message/rfc822" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${message.subject.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "message"}.eml`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMenuOpen(false);
  }

  async function copyMessageText() {
    try {
      await navigator.clipboard.writeText(emailHtmlToPlainText(message.body));
      setMenuFeedback("Copied to clipboard.");
    } catch {
      setMenuFeedback("Copy failed in this browser.");
    }
  }

  if (collapsed && !forceExpanded) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title="Expand message"
        className="flex w-full items-center justify-between gap-3 bg-white px-1 py-4 text-left transition-colors hover:bg-paper"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lead text-[11px] font-semibold text-white">
            {initials}
          </div>
          <span className="shrink-0 text-[13px] font-semibold text-ink">
            {message.senderName}
          </span>
          <span className="truncate text-[13px] text-dim">
            {emailHtmlToPlainText(message.body).slice(0, 100)}…
          </span>
        </div>
        <span className="shrink-0 text-[12px] text-faint" suppressHydrationWarning>
          {new Date(message.sentAt).toLocaleTimeString("en-GB", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </button>
    );
  }

  return (
    <div className="bg-white px-1 py-6 first:pt-1 last:pb-1">
      {/* Sender header. The avatar + name row is the collapse control: tapping
          it folds the message back to a strip, the same target that expands it
          again — no separate up/down chevron. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Collapse message"
            className="flex min-w-0 items-center gap-3 text-left print:hidden"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lead text-[13px] font-semibold text-white">
              {initials}
            </div>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{message.senderName}</span>
              <span className="text-[12px] text-faint">&lt;{message.senderEmail}&gt;</span>
              {message.isFromClient && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-go-wash px-2.5 py-1 text-[11px] leading-none font-semibold text-go">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  Client
                </span>
              )}
            </span>
          </button>

          {/* Print-only sender line — the interactive header above is hidden
              when printing. */}
          <div className="hidden items-center gap-2 print:flex">
            <span className="text-sm font-semibold text-ink">{message.senderName}</span>
            <span className="text-[12px] text-faint">&lt;{message.senderEmail}&gt;</span>
          </div>

          <div className="relative pl-[52px] print:pl-0">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-[13px] font-medium text-dim transition-colors hover:text-ink print:hidden"
            >
              <span>to {message.recipientName}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            <span className="hidden text-[13px] font-medium text-dim print:inline">
              to {message.recipientName} &lt;{message.recipientEmail}&gt;
            </span>

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

        {/* Timestamp & per-message actions */}
        <div className="flex shrink-0 items-center gap-1 text-[12px] text-faint">
          <span className="mr-1" suppressHydrationWarning>
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
            title="Reply to this message"
            onClick={() => onReply(message)}
            className="flex h-7 w-7 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink print:hidden"
          >
            <Reply className="h-3.5 w-3.5" />
          </button>
          <div className="relative print:hidden" ref={menuRef}>
            <button
              type="button"
              title="More options"
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuFeedback(null);
                setMenuOpen((open) => !open);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute top-full right-0 z-20 mt-1 w-56 rounded-inset border border-rule bg-white py-1 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.4)]">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onReply(message);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-paper"
                >
                  <Reply className="h-3.5 w-3.5 text-faint" />
                  Reply
                </button>
                <button
                  type="button"
                  onClick={downloadMessage}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-paper"
                >
                  <Download className="h-3.5 w-3.5 text-faint" />
                  Download message
                </button>
                <button
                  type="button"
                  onClick={() => void copyMessageText()}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-paper"
                >
                  <Copy className="h-3.5 w-3.5 text-faint" />
                  Copy message text
                </button>
                <div className="my-1 border-t border-rule-soft" />
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onSuppressClient();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-stop transition-colors hover:bg-stop-wash disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Suppress client
                </button>
                {menuFeedback && (
                  <p className="px-3 py-1.5 text-[12px] font-medium text-dim" role="status">
                    {menuFeedback}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body — outgoing mail is stored as editor HTML (F117), client replies
          as plain text. HTML is re-sanitized on every render, the same rule
          the client record's outreach history follows. */}
      {isRichEmailHtml(message.body) ? (
        <div
          className="mt-4 text-sm leading-[1.65] text-ink font-body [&_a]:text-lead [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-rule [&_blockquote]:pl-3 [&_blockquote]:text-dim [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.body) }}
        />
      ) : (
        <div className="mt-4 text-sm leading-[1.65] text-ink whitespace-pre-wrap font-body">
          {message.body}
        </div>
      )}

      {/* Attachments */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-5">
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

/** The client's latest inbound message in a thread, or undefined if none. */
function lastClientReply(thread: InboxThreadView) {
  for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
    if (thread.messages[i]!.isFromClient) return thread.messages[i];
  }
  return undefined;
}

export function GmailReadingPane({
  thread,
  onBack,
  onToggleStar,
  onDelete,
  onMarkUnread,
  canSetStatus = false,
  onCancelScheduled,
  onRescheduleScheduled,
  onScheduledEdited,
  onSend,
  viewerId = null,
  viewerRole = null,
  onOwnershipChanged,
}: GmailReadingPaneProps) {
  // Unowned threads keep the reply composer's claim-first dialog; only a client
  // someone else owns swaps Reply for the banner.
  const ownedByOther =
    viewerId !== null && viewerRole !== null && thread.ownerId !== null && thread.ownerId !== viewerId;
  // Real conversation messages: drafts are intentions, not history. Drafts
  // belong exclusively in the reply composer, never rendered as sent email
  // cards in the thread history above it.
  const existingDraft = thread.messages.find((msg) => msg.pendingKind === "draft");
  const messages = thread.messages.filter((msg) => msg.pendingKind !== "draft");

  const [replyOpen, setReplyOpen] = useState(false);
  /** The message a per-message Reply is answering; null answers the latest
      client reply (the bottom Reply button's meaning). */
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesCount, setNotesCount] = useState<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const replyBoxRef = useRef<HTMLDivElement>(null);

  /** Smoothly scrolls the reading pane container so the reply composer and its input
      field are comfortably and naturally visible in the viewport. */
  const scrollReplyIntoView = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollContainerRef.current;
    const box = replyBoxRef.current;
    if (!container || !box) return;

    const containerRect = container.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();

    if (boxRect.height >= containerRect.height - 48) {
      // Box is very tall or screen is short: align near top of the container
      const topDiff = boxRect.top - containerRect.top - 16;
      container.scrollBy({ top: topDiff, behavior });
    } else {
      // Box fits within container: bring bottom comfortably into view with 28px breathing room
      const bottomOverflow = boxRect.bottom - containerRect.bottom + 28;
      if (bottomOverflow > 0) {
        container.scrollBy({ top: bottomOverflow, behavior });
      }
    }
  }, []);

  // When reply opens or switches target, glide smoothly down into view
  useEffect(() => {
    if (!replyOpen) return;

    const frameId = requestAnimationFrame(() => {
      scrollReplyIntoView("smooth");
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [replyOpen, replyToMessageId, scrollReplyIntoView]);

  // If composer expands while open (e.g. switching from AI settings to manual draft, or streaming draft text),
  // keep the action dialogue comfortably in view if the user is currently looking at it.
  useEffect(() => {
    if (!replyOpen) return;
    const box = replyBoxRef.current;
    const container = scrollContainerRef.current;
    if (!box || !container) return;

    let initial = true;
    let prevHeight = box.offsetHeight;

    const ro = new ResizeObserver((entries) => {
      if (initial) {
        initial = false;
        return;
      }
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        if (newHeight - prevHeight > 20) {
          prevHeight = newHeight;
          const distFromBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight;
          if (distFromBottom < 350) {
            scrollReplyIntoView("smooth");
          }
        } else if (newHeight < prevHeight) {
          prevHeight = newHeight;
        }
      }
    });

    ro.observe(box);
    return () => ro.disconnect();
  }, [replyOpen, scrollReplyIntoView]);

  // True only while the browser's print dialog is open. Every message card
  // renders expanded for the printout — a collapsed card would print its
  // one-line snippet instead of the email.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadNotesCount() {
      try {
        const res = await fetch(`/api/clients/${thread.id}/notes`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { notes?: unknown[] };
        if (Array.isArray(data.notes) && !cancelled) {
          setNotesCount(data.notes.length);
        }
      } catch {
        // ignore
      }
    }
    void loadNotesCount();
    return () => {
      cancelled = true;
    };
  }, [thread.id]);

  // Scheduled-send controls: a cancel in flight, the last refusal, and the two
  // in-thread changes — editing the email in place, or picking a new time.
  const [scheduledBusy, setScheduledBusy] = useState<"cancel" | null>(null);
  const [scheduledError, setScheduledError] = useState<string | null>(null);
  const [editingScheduled, setEditingScheduled] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  // The pane instance is reused as the reader moves between threads — clear the
  // notes and drop any open sheet / half-typed note when the client changes.
  // Adjusting state during render (React's documented pattern) rather than in an
  // effect, so there is no extra commit with stale notes on screen.
  const [seededFor, setSeededFor] = useState(thread.id);
  if (seededFor !== thread.id) {
    setSeededFor(thread.id);
    setNotesCount(0);
    setNotesOpen(false);
    setReplyOpen(false);
    setReplyToMessageId(null);
    setSuppressOpen(false);
    setScheduledBusy(null);
    setScheduledError(null);
    setEditingScheduled(false);
    setRescheduleOpen(false);
  }

  const latestReply = lastClientReply(thread);
  const replyTarget = messages.find((msg) => msg.id === replyToMessageId) ?? null;

  function handleOpenReply() {
    setReplyToMessageId(null);
    setReplyOpen(true);
  }

  /** A per-message Reply opens the composer answering that message (when it is
      the client's) and smoothly brings it into view. */
  function handleMessageReply(msg: InboxEmailMessage) {
    setReplyToMessageId(msg.isFromClient ? msg.id : null);
    setReplyOpen(true);
  }
  // The queued send the banner below manages, if the thread carries one.
  const scheduledMessage = thread.messages.find(
    (message) => message.pendingKind === "scheduled",
  );

  async function runCancelScheduled() {
    if (!scheduledMessage || !onCancelScheduled || scheduledBusy) return;
    setScheduledBusy("cancel");
    setScheduledError(null);
    const error = await onCancelScheduled(scheduledMessage.id);
    // Null means the shell handled it (refreshed, moved on); a string stays
    // here, on the banner the CAM was reading.
    if (error) {
      setScheduledError(error);
      setScheduledBusy(null);
    }
  }

  /** The time picker's confirm. True shows its "done" step; false keeps it open. */
  async function confirmReschedule(when: Date): Promise<boolean> {
    if (!scheduledMessage || !onRescheduleScheduled) return false;
    setRescheduling(true);
    setScheduledError(null);
    const error = await onRescheduleScheduled(scheduledMessage.id, when);
    setRescheduling(false);
    if (error) {
      setScheduledError(error);
      setRescheduleOpen(false);
      return false;
    }
    return true;
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white">
      {/* Top action header */}
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
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
            {notesCount > 0 && (
              <span className="font-mono text-[10.5px] tabular-nums text-faint">
                {notesCount}
              </span>
            )}
          </button>
          <Link
            href={`/clients/${thread.id}`}
            title="Open client record"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-inset px-2.5 py-1 text-[13px] font-semibold text-lead transition-colors hover:bg-lead-wash"
          >
            <span>Client record</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Conversation. `id` is the print target: the global `@media print` rule
          in globals.css hides everything on the page except this subtree, so
          the printout is the thread alone — no app shell, no inbox list, no
          notes drawer. */}
      <div
        id="inbox-print-region"
        ref={scrollContainerRef}
        className="flex-1 space-y-5 overflow-y-auto px-8 py-6"
      >
        {/* Headline */}
        <div className="space-y-2 pb-4">
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

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-dim">
            <div className="flex items-center gap-1.5 font-medium text-ink">
              <Building2 className="h-[15px] w-[15px] text-faint shrink-0" />
              <span>{thread.orgName}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-body text-[12px] uppercase font-bold tracking-[-0.01em] text-ink">
                Owner
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-rule bg-white px-2.5 py-1 text-[12px] font-medium text-dim">
                <span
                  aria-hidden="true"
                  className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[9.5px] font-semibold text-white"
                >
                  {getInitials(thread.camOwner.name)}
                </span>
                <span className="text-[13.5px] font-medium text-ink">
                  {thread.camOwner.name}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-body text-[12px] uppercase font-bold tracking-[-0.01em] text-ink">
                Stage
              </span>
              {canSetStatus ? (
                <StatusSelect
                  organisationId={thread.id}
                  currentStatus={thread.outreachStatus ?? "not_contacted"}
                  idSuffix="inbox"
                  showNudge={false}
                />
              ) : (
                thread.outreachStatus && (
                  <span className="inline-flex items-center rounded-full border border-rule bg-white px-3 py-1 text-[13.5px] font-medium text-ink">
                    {formatOutreachStatus(thread.outreachStatus)}
                  </span>
                )
              )}
            </div>
          </div>
        </div>

        {/* Scheduled send — this message has not gone out yet. Say so plainly,
            with the due time, so the pane never reads like a normal sent mail.
            The text itself renders as a message card below with the rest; the
            banner carries the only two things a CAM can still do to it. */}
        {thread.folder === "scheduled" && thread.scheduledFor && (
          <div className="flex items-start gap-2.5 rounded-inset border border-hold/25 bg-hold-wash px-4 py-3">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-hold" />
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
              <p className="font-semibold text-hold">Scheduled to be sent</p>
              <p className="text-dim" suppressHydrationWarning>
                Goes out {formatScheduledFor(thread.scheduledFor)}. You can still
                edit it, change the time or cancel it until then.
              </p>
              {scheduledMessage && (onCancelScheduled || onRescheduleScheduled || onScheduledEdited) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {onScheduledEdited && !editingScheduled && (
                    <button
                      type="button"
                      disabled={scheduledBusy !== null}
                      onClick={() => {
                        setScheduledError(null);
                        setEditingScheduled(true);
                      }}
                      className="rounded-inset bg-ink px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
                    >
                      Edit
                    </button>
                  )}
                  {onRescheduleScheduled && !editingScheduled && (
                    <button
                      type="button"
                      disabled={scheduledBusy !== null}
                      onClick={() => {
                        setScheduledError(null);
                        setRescheduleOpen(true);
                      }}
                      className="rounded-inset border border-hold/30 px-3 py-1.5 text-[12px] font-semibold text-hold transition-colors hover:bg-hold/10 disabled:opacity-50"
                    >
                      Change time
                    </button>
                  )}
                  {onCancelScheduled && (
                    <button
                      type="button"
                      disabled={scheduledBusy !== null}
                      onClick={() => void runCancelScheduled()}
                      className="rounded-inset border border-hold/30 px-3 py-1.5 text-[12px] font-semibold text-hold transition-colors hover:bg-hold/10 disabled:opacity-50"
                    >
                      {scheduledBusy === "cancel" ? "Cancelling…" : "Cancel schedule"}
                    </button>
                  )}
                </div>
              )}
              {scheduledError && (
                <p className="mt-2 text-[12px] font-semibold text-stop" role="alert">
                  {scheduledError}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Messages — one uniform surface; a hairline between emails is the
            only separator, sent and received alike. Bodies arrive per thread on
            open (the list query omits them), so the first paint has headers but
            no emails yet: skeletons hold the space rather than a blank gap that
            then jumps when the conversation lands. */}
        {messages.length === 0 ? (
          <div
            className="divide-y divide-rule-soft animate-pulse"
            aria-label="Loading conversation…"
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                // `first:pt-1 last:pb-1` copied from the real message row, so the
                // top and bottom of the conversation sit where they will.
                className="bg-white px-1 py-6 first:pt-1 last:pb-1"
                aria-hidden="true"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-full bg-paper-sunk" />
                    <div className="min-w-0 space-y-2">
                      <div className="h-3.5 w-36 rounded bg-paper-sunk" />
                      <div className="h-3 w-52 max-w-full rounded bg-paper-sunk" />
                    </div>
                  </div>
                  <div className="h-3 w-16 shrink-0 rounded bg-paper-sunk" />
                </div>
                <div className="mt-4 space-y-2 pl-[52px]">
                  <div className="h-3.5 w-full rounded bg-paper-sunk" />
                  <div className="h-3.5 w-11/12 rounded bg-paper-sunk" />
                  <div className="h-3.5 w-2/3 rounded bg-paper-sunk" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-rule-soft">
            {messages.map((msg, idx) => {
              const isLatest = idx === messages.length - 1;
              const isCollapsed = messages.length > 2 && idx < messages.length - 2;

              // Editing a scheduled email happens where the email is: its card
              // becomes the review panel, formatting intact, and the schedule
              // stays live until the edit is approved and saved.
              if (msg.pendingKind === "scheduled" && editingScheduled && thread.scheduledFor) {
                return (
                  <div className="py-5" key={msg.id}>
                    <div className="rounded-panel border border-rule bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[12px] text-dim" suppressHydrationWarning>
                          Editing a scheduled email · still goes out{" "}
                          {formatScheduledFor(thread.scheduledFor)} as it was until you save
                        </p>
                        <button
                          type="button"
                          onClick={() => setEditingScheduled(false)}
                          title="Stop editing — nothing changes"
                          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <EmailReviewPanel
                        className="mt-3"
                        description="Change the wording or the time. Approve it again to save — it keeps its place in the schedule until you do."
                        draft={{
                          id: msg.id,
                          subject: msg.subject || thread.subject,
                          body: msg.body,
                          recipientOnFile: thread.primaryContact.email || null,
                          savedRecipient: msg.recipientEmail || null,
                          newsSource: msg.newsSource,
                          newsHook: msg.newsHook,
                          newsUrl: msg.newsUrl,
                        }}
                        editingScheduled
                        heading="Edit scheduled email"
                        idPrefix={`scheduled-edit-${msg.id}`}
                        initialScheduledAt={thread.scheduledFor}
                        onCommitted={() => {
                          setEditingScheduled(false);
                          onScheduledEdited?.();
                        }}
                        organisationId={thread.id}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <SingleMessageCard
                  key={msg.id}
                  message={msg}
                  isLatest={isLatest}
                  isCollapsedByDefault={isCollapsed}
                  forceExpanded={printing}
                  onReply={handleMessageReply}
                  onSuppressClient={() => setSuppressOpen(true)}
                />
              );
            })}
          </div>
        )}

        {/* Reply — the real, approved send path.
            What used to sit here was a textarea whose Send only pushed a message
            into local state: it looked like a send, wrote nothing to the
            database, and skipped suppression, ownership and the human-review
            gate entirely. ReplyComposer generates a Stage 2 draft and hands it
            to EmailReviewPanel, which is the one component allowed to render
            the approval control (see lib/outreach/human-send-control.test.ts). */}
        <div className="pt-4 print:hidden" ref={replyBoxRef}>
          {ownedByOther && viewerRole && thread.ownerId ? (
            <ThreadOwnershipBanner
              organisationId={thread.id}
              ownerId={thread.ownerId}
              ownerName={thread.camOwner.name}
              viewerRole={viewerRole}
              onOwnershipChanged={() => onOwnershipChanged?.()}
            />
          ) : (
          <AnimatePresence initial={false} mode="wait">
            {!replyOpen ? (
              <motion.button
                key="reply-trigger-btn"
                type="button"
                onClick={handleOpenReply}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex cursor-pointer items-center gap-2 rounded-inset bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
              >
                <Reply className="h-4 w-4" />
                <span>Reply to {thread.primaryContact.name}</span>
              </motion.button>
            ) : (
              <motion.div
                key="reply-composer-card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-panel border border-rule bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[12px] text-dim">
                    Replying to{" "}
                    <span className="font-semibold text-ink">{thread.primaryContact.name}</span>{" "}
                    &lt;{thread.primaryContact.email}&gt;
                    {replyTarget && replyTarget.id !== latestReply?.id && (
                      <span className="text-faint">
                        {" "}
                        · answering {replyTarget.senderName} ·{" "}
                        {new Date(replyTarget.sentAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyOpen(false);
                      setReplyToMessageId(null);
                    }}
                    title="Close the reply"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* F135: the reply being answered is the message the CAM hit Reply
                    on — a per-message Reply names it, otherwise the client's most
                    recent one in this thread. The Stage 2 route loads that row's
                    text itself; only its id travels from here. */}
                <ReplyComposer
                  className="mt-3"
                  key={replyToMessageId ?? existingDraft?.id ?? "latest"}
                  organisationId={thread.id}
                  recipientOnFile={thread.primaryContact.email || null}
                  ownerId={thread.ownerId}
                  orgName={thread.orgName}
                  replyEventId={replyTarget?.id ?? lastClientReply(thread)?.id}
                  threadSubject={thread.subject}
                  initialDraft={
                    existingDraft
                      ? {
                          id: existingDraft.id,
                          subject: existingDraft.subject,
                          body: existingDraft.body ? emailHtmlToPlainText(existingDraft.body) : "",
                          newsSource: existingDraft.newsSource,
                          newsHook: existingDraft.newsHook,
                          newsUrl: existingDraft.newsUrl,
                        }
                      : undefined
                  }
                  onSend={onSend}
                  onClose={() => {
                    setReplyOpen(false);
                    setReplyToMessageId(null);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
          )}
        </div>
      </div>

      {/* Change time — the same picker scheduling uses, so moving a send asks
          the question the same way. The content is untouched, so no approval. */}
      {onRescheduleScheduled && (
        <ScheduleSendDialog
          committing={rescheduling}
          doneMessage={
            thread.scheduledFor
              ? `Moved from ${formatScheduleLong(new Date(thread.scheduledFor))}. It will send automatically at the new time.`
              : "It will send automatically at the new time."
          }
          onClose={() => setRescheduleOpen(false)}
          onConfirm={confirmReschedule}
          open={rescheduleOpen}
        />
      )}

      {/* Client notes drawer with @teammate mention support */}
      <AnimatePresence>
        {notesOpen && (
          <ThreadNotesDrawer
            isOpen={notesOpen}
            onClose={() => setNotesOpen(false)}
            thread={thread}
            onNotesCountChange={setNotesCount}
          />
        )}
      </AnimatePresence>

      {/* Suppress-client confirm dialog — opens from a message's ⋮ → Suppress
          client. Rendered at pane level so it survives the message card
          collapsing under it. */}
      {suppressOpen && (
        <SuppressClientDialog
          orgName={thread.orgName}
          organisationId={thread.id}
          onClose={() => setSuppressOpen(false)}
        />
      )}
    </div>
  );
}
