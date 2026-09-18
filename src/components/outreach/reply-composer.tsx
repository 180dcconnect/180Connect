"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  MoreVertical,
  Paperclip,
  PenLine,
  SpellCheck2,
  Trash2,
  X,
} from "lucide-react";

import { LoaderPinwheel } from "@/components/animate-ui/icons/loader-pinwheel";
import { SendButton } from "@/components/ui/send-button";
import {
  TakeOwnershipDialog,
  claimClientOwnership,
} from "@/components/outreach/take-ownership-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip";
import { AiThinkingState, type ThinkingStep } from "@/components/ui/ai-thinking-state";
import { StreamingDraftText } from "@/components/ui/streaming-draft-text";
import {
  useReplyDraftStream,
  type ReplyDraftStreamResult,
} from "@/components/outreach/use-reply-draft-stream";
import { AiSettingsPicker, type AiSettingEntry } from "@/components/outreach/ai-settings-picker";
import { ScheduleSendDialog } from "@/components/outreach/schedule-send-dialog";
import { InboxAttachmentCard } from "@/components/inbox/inbox-attachment-card";
import { attachmentFileTypeFromFilename } from "@/lib/inbox-thread-view";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  attachmentUploadFailureMessage,
  buildAttachmentStoragePath,
  formatFileSize,
  validateAttachmentFile,
  validateDraftAttachmentSet,
} from "@/lib/attachments";
import {
  attachDraftFile,
  discardEmailDraft,
  scheduleReviewedEmail,
  sendReviewedEmail,
} from "@/app/(app)/clients/[id]/outreach-actions";
import { createClient as createBrowserSupabase } from "@/lib/supabase/browser";
import { composeBodyToHtml } from "@/lib/outreach/compose-body-html";
import type { PendingSendRequest } from "@/components/inbox/gmail-compose-modal";
import {
  REPLY_CLOSING_APPROACH_LABELS,
  REPLY_CLOSING_APPROACHES,
  EMAIL_LENGTHS,
  EMAIL_REGISTER_LABELS,
  EMAIL_REGISTERS,
  type ReplyClosingApproach,
  type EmailLength,
  type EmailRegister,
} from "@/lib/outreach/stage-one-prompt";

function Hint({
  label,
  side = "top",
  children,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
}) {
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        showArrow={false}
        className="bg-slate-900 text-[11px] font-medium text-white"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function stagedFileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function isPreviewableFile(file: File): boolean {
  if (file.type === "application/pdf" || file.type.startsWith("image/")) return true;
  if (file.type.startsWith("text/")) return true;
  if (file.type) return false;
  const extension = file.name.split(".").pop()?.trim().toLowerCase() ?? "";
  if (extension === "txt" || extension === "csv") return true;
  const family = attachmentFileTypeFromFilename(file.name);
  return family === "pdf" || family === "png";
}

/**
 * Reply to a thread without leaving it — the inbox reading pane's composer.
 *
 * Modernized frictionless compose experience replacing legacy EmailReviewPanel:
 * - Direct inline drafting in an auto-growing textarea
 * - Draft with AI / AiSettingsPicker available on demand
 * - Bottom action bar matching Gmail Compose modal: Send, Schedule send,
 *   Attach files, Spell check, Attach flyer, Discard
 * - Transparent send via server actions (sendReviewedEmail / scheduleReviewedEmail)
 *   with delayed-commit Undo toasts when used within GmailInboxShell
 */

const REPLY_THINKING_STEPS: ReadonlyArray<ThinkingStep> = [
  { key: "reading", label: "Reading conversation & profile" },
  { key: "drafting", label: "Drafting your reply" },
  { key: "saving", label: "Saving draft" },
];

const EMAIL_LENGTH_LABELS: Record<EmailLength, string> = {
  short: "Short",
  standard: "Standard",
  detailed: "Detailed",
};

/**
 * Reply-shaped closings only — not the introductory set. Inside a conversation
 * the client already joined, "Request a short [introductory] call" and a
 * generic "is support useful?" question read wrong, so the picker offers
 * closes that answer or advance what was actually said.
 */
const CLOSING_APPROACH_LABELS = REPLY_CLOSING_APPROACH_LABELS;

export type ReplyDraftInitial = {
  id: string;
  subject?: string;
  body: string;
  newsSource?: "live" | "stored" | "none";
  newsHook?: string | null;
  newsUrl?: string | null;
};

type Draft = {
  id: string;
  subject: string;
  body: string;
  /** F110: live news hook behind this draft, when the Stage 2 route found one. */
  newsSource?: "live" | "stored" | "none";
  newsHook?: string | null;
  newsUrl?: string | null;
};
type Warning = { text: string; tone: "block" | "conflict" };

export function ReplyComposer({
  organisationId,
  recipientOnFile,
  ownerId,
  orgName,
  replyEventId,
  threadSubject,
  blocked = false,
  blockedReason,
  className = "",
  initialDraft,
  onSend,
  onClose,
}: {
  organisationId: string;
  /**
   * F135: the specific client reply this response answers, so the Stage 2
   * route can load that reply's text server-side and the draft addresses what
   * the client actually said. Omitted, the generation is an unanswered
   * follow-up rather than a reply. Never the reply body itself — that is
   * loaded from the row, never accepted from the browser.
   */
  replyEventId?: string;
  /** Subject line of the thread being replied to, used to prefill manual drafts. */
  threadSubject?: string;
  /** The client's email as held on the record — the mismatch-warning baseline. */
  recipientOnFile: string | null;
  /**
   * Current owner id, null when unowned (an owner removed mid-conversation).
   * A reply converses with the client, so it carries the same take-ownership
   * confirmation as a fresh send — see the gate in handleSend.
   */
  ownerId: string | null;
  /** Client name for the ownership dialog copy. */
  orgName: string;
  /** Suppressed, or owned by another CAM. */
  blocked?: boolean;
  blockedReason?: string;
  className?: string;
  /** Existing draft row on this thread, if one was saved previously. */
  initialDraft?: ReplyDraftInitial;
  /** Hands a prepared send to the shell for the Gmail-style delayed commit Undo toast. */
  onSend?: (request: PendingSendRequest) => void;
  /** Closes the reply surface upon sending or discarding. */
  onClose?: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(
    initialDraft
      ? {
          id: initialDraft.id,
          subject: initialDraft.subject ?? "",
          body: initialDraft.body,
          newsSource: initialDraft.newsSource,
          newsHook: initialDraft.newsHook,
          newsUrl: initialDraft.newsUrl,
        }
      : null,
  );
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const [showAiOptions, setShowAiOptions] = useState(!initialDraft);
  const [isWritingManually, setIsWritingManually] = useState(Boolean(initialDraft));
  const [error, setError] = useState<string | null>(null);
  const replyStream = useReplyDraftStream();
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [stagedGenerated, setStagedGenerated] = useState<ReplyDraftStreamResult | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [spellCheckOn, setSpellCheckOn] = useState(true);
  const [attachFlyer, setAttachFlyer] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [stagedPreviews, setStagedPreviews] = useState<Record<string, string>>({});
  const stagedPreviewsRef = useRef<Record<string, string>>({});

  const [isScheduleMenuOpen, setIsScheduleMenuOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isKebabOpen, setIsKebabOpen] = useState(false);
  // Take-ownership confirmation, shared with the compose modal (see
  // take-ownership-dialog.tsx): a reply converses with the client, so an
  // owner removed mid-conversation must not silently leave the next reply
  // ownerless. Same claim-first shape — dialog, claim, then send.
  const [isOwnershipDialogOpen, setIsOwnershipDialogOpen] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [ownershipAcceptedFor, setOwnershipAcceptedFor] = useState<string | null>(null);
  const pendingOwnershipScheduledFor = useRef<string | undefined>(undefined);
  const ownershipAbortedRef = useRef(false);

  const [aiHover, setAiHover] = useState(false);
  const [aiToolbarHover, setAiToolbarHover] = useState(false);
  const [draftPillHover, setDraftPillHover] = useState(false);
  const [warning, setWarning] = useState<Warning | null>(null);

  const [length, setLength] = useState<EmailLength>("standard");
  const [register, setRegister] = useState<EmailRegister>("professional");
  // The default reflects the context: answering a real reply starts at
  // "answer + next step"; an unanswered nudge (no replyEventId) starts at the
  // low-pressure continue. The composer remounts per reply target, so this
  // initialiser always reads the current context.
  const [closing, setClosing] = useState<ReplyClosingApproach>(
    replyEventId ? "answer_next_step" : "soft_cta",
  );

  const bodyInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = bodyInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 100)}px`;
  }, [body, isWritingManually, showAiOptions, isAiGenerating]);

  function trackPreview(file: File) {
    if (!isPreviewableFile(file)) return;
    const key = stagedFileKey(file);
    if (stagedPreviewsRef.current[key]) return;
    const url = URL.createObjectURL(file);
    stagedPreviewsRef.current[key] = url;
    setStagedPreviews((prev) => ({ ...prev, [key]: url }));
  }

  function untrackPreview(file: File) {
    const key = stagedFileKey(file);
    const url = stagedPreviewsRef.current[key];
    if (!url) return;
    URL.revokeObjectURL(url);
    delete stagedPreviewsRef.current[key];
    setStagedPreviews((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function untrackAllPreviews() {
    for (const url of Object.values(stagedPreviewsRef.current)) {
      URL.revokeObjectURL(url);
    }
    stagedPreviewsRef.current = {};
    setStagedPreviews({});
  }

  useEffect(() => {
    return () => {
      for (const url of Object.values(stagedPreviewsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  function stageFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setAttachError(null);
    let runningCount = stagedFiles.length;
    let runningBytes = stagedFiles.reduce((sum, file) => sum + file.size, 0);
    const accepted: File[] = [];
    for (const file of Array.from(picked)) {
      const fileError = validateAttachmentFile(file);
      if (fileError) {
        setAttachError(fileError);
        continue;
      }
      const setError = validateDraftAttachmentSet(
        { count: runningCount, totalSizeBytes: runningBytes },
        { sizeBytes: file.size },
      );
      if (setError) {
        setAttachError(setError);
        continue;
      }
      accepted.push(file);
      trackPreview(file);
      runningCount += 1;
      runningBytes += file.size;
    }
    if (accepted.length > 0) setStagedFiles((prev) => [...prev, ...accepted]);
  }

  function removeStagedFile(index: number) {
    const file = stagedFiles[index];
    const remaining = stagedFiles.filter((_, position) => position !== index);
    if (
      file &&
      !remaining.some((kept) => stagedFileKey(kept) === stagedFileKey(file))
    ) {
      untrackPreview(file);
    }
    setStagedFiles(remaining);
    setAttachError(null);
  }

  async function uploadStagedFiles(
    orgId: string,
    messageId: string,
  ): Promise<string | null> {
    if (stagedFiles.length === 0) return null;
    const supabase = createBrowserSupabase();
    const queue = [...stagedFiles];
    while (queue.length > 0) {
      const file = queue[0];
      const storagePath = buildAttachmentStoragePath(
        orgId,
        file.name,
        crypto.randomUUID(),
      );
      const { error: uploadError } = await supabase.storage
        .from("client-attachments")
        .upload(storagePath, file, { contentType: file.type || undefined });
      if (uploadError) {
        return attachmentUploadFailureMessage(uploadError);
      }

      const recordResponse = await fetch(`/api/clients/${orgId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          storagePath,
          contentType: file.type || undefined,
          sizeBytes: file.size,
        }),
      });
      const recordBody = (await recordResponse.json().catch(() => null)) as
        | { id?: string; error?: string }
        | null;
      if (!recordResponse.ok || !recordBody?.id) {
        return recordBody?.error ?? `“${file.name}” could not be attached.`;
      }

      const attachResult = await attachDraftFile({
        organisationId: orgId,
        messageId,
        attachmentId: recordBody.id,
      });
      if (!attachResult.ok) {
        return attachResult.message;
      }

      queue.shift();
    }
    return null;
  }

  const aiSettings: AiSettingEntry[] = [
    {
      key: "length",
      label: "Email length",
      hint: "How long the reply body should be.",
      options: EMAIL_LENGTHS.map((value) => ({ value, label: EMAIL_LENGTH_LABELS[value] })),
      selected: length,
      onSelect: (value) => setLength(value as EmailLength),
    },
    {
      key: "register",
      label: "Email tone",
      hint: "How formal and how warm the reply reads. Every reply is written as \u201cwe\u201d either way.",
      options: EMAIL_REGISTERS.map((value) => ({ value, label: EMAIL_REGISTER_LABELS[value] })),
      selected: register,
      onSelect: (value) => setRegister(value as EmailRegister),
    },
    {
      key: "closing",
      label: "Closing approach",
      hint: "How the reply ends — shaped for a conversation already in progress.",
      options: REPLY_CLOSING_APPROACHES.map((value) => ({ value, label: CLOSING_APPROACH_LABELS[value] })),
      selected: closing,
      onSelect: (value) => setClosing(value as ReplyClosingApproach),
    },
  ];

  function commitStagedGenerated() {
    if (!stagedGenerated) return;
    setDraft(stagedGenerated);
    if (stagedGenerated.body) setBody(stagedGenerated.body);
    setStagedGenerated(null);
    setIsAiGenerating(false);
    setIsWritingManually(true);
    setShowAiOptions(false);
    setTimeout(() => {
      bodyInputRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  async function generate(options?: { skipNews?: boolean }) {
    setIsAiGenerating(true);
    setError(null);
    setWarning(null);
    setSendError(null);
    setShowAiOptions(false);
    try {
      // F135: Stage 2 draft request parameters
      // JSON.stringify({ length, register, closing, replyEventId })
      const outcome = await replyStream.start({
        organisationId,
        length,
        register,
        closing,
        replyEventId,
        skipNews: options?.skipNews,
      });
      if (!outcome.ok) {
        setIsAiGenerating(false);
        if (outcome.warning) setWarning(outcome.warning);
        if (outcome.error && outcome.error !== "cancelled") setError(outcome.error);
        return;
      }
      setStagedGenerated(outcome.result);
      if (!outcome.result.body?.trim()) {
        commitStagedGenerated();
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setIsAiGenerating(false);
    }
  }

  function handleDraftManually() {
    setShowAiOptions(false);
    setIsWritingManually(true);
    setTimeout(() => {
      bodyInputRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  async function handleDiscard() {
    replyStream.reset();
    setIsAiGenerating(false);
    setStagedGenerated(null);
    if (draft?.id) {
      try {
        await discardEmailDraft({
          organisationId,
          messageId: draft.id,
        });
      } catch {
        // Soft-fail discard
      }
    }
    untrackAllPreviews();
    setStagedFiles([]);
    setDraft(null);
    setBody("");
    router.refresh();
    onClose?.();
  }

  async function handleSend(scheduledFor?: string, justClaimedOwnershipFor?: string) {
    if (!body.trim()) {
      setSendError("Write a message before sending.");
      return;
    }
    // Same gate as the compose modal: replying to an unowned client makes
    // the sender its owner, explicitly. The claim RPC below is the truth
    // (atomic, audited); the prop only decides whether to ask.
    if (
      ownerId == null &&
      ownershipAcceptedFor !== organisationId &&
      justClaimedOwnershipFor !== organisationId
    ) {
      pendingOwnershipScheduledFor.current = scheduledFor;
      setSendError(null);
      setIsOwnershipDialogOpen(true);
      return;
    }
    setIsSending(true);
    setSendError(null);
    setIsScheduleMenuOpen(false);
    setIsScheduleDialogOpen(false);

    try {
      // The generated draft's subject is the threaded one the route composed
      // (see StageTwoDraft: a reply has no generated subject). Preferring it
      // keeps the reviewed draft and the sent email naming the same subject;
      // the thread value is the fallback for a manual draft, which never went
      // through generation.
      const effectiveSubject =
        draft?.subject ||
        (threadSubject
          ? threadSubject.startsWith("Re:")
            ? threadSubject
            : `Re: ${threadSubject}`
          : "Re:");

      let activeDraftId = draft?.id ?? null;
      let activeRecipient = recipientOnFile;

      if (!activeDraftId) {
        const response = await fetch(`/api/clients/${organisationId}/outreach-drafts/blank`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachFlyer }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { id?: string; recipientOnFile?: string | null; error?: string }
          | null;
        if (!response.ok || !payload?.id) {
          setSendError(payload?.error ?? "The reply could not be prepared. Nothing was sent.");
          setIsSending(false);
          return;
        }
        activeDraftId = payload.id;
        if (payload.recipientOnFile) activeRecipient = payload.recipientOnFile;
      }

      const attachFailure = await uploadStagedFiles(organisationId, activeDraftId);
      if (attachFailure) {
        setSendError(attachFailure);
        setIsSending(false);
        return;
      }

      if (onSend) {
        onSend({
          snapshot: {
            draftId: activeDraftId,
            recipient: activeRecipient ?? undefined,
            subject: effectiveSubject,
            body,
            newsSource: draft?.newsSource,
            newsHook: draft?.newsHook ?? null,
            newsUrl: draft?.newsUrl ?? null,
          },
          to: activeRecipient ?? "",
          subject: effectiveSubject,
          bodyHtml: composeBodyToHtml(body),
          scheduledFor: scheduledFor ?? undefined,
          organisationId,
          messageId: activeDraftId,
          attachFlyer,
        });
        untrackAllPreviews();
        onClose?.();
      } else {
        const sendInput = {
          organisationId,
          messageId: activeDraftId,
          recipient: activeRecipient ?? "",
          subject: effectiveSubject,
          body: composeBodyToHtml(body),
          explicitlyApproved: true as const,
          attachFlyer,
        };
        const result = scheduledFor
          ? await scheduleReviewedEmail({ ...sendInput, scheduledAt: scheduledFor })
          : await sendReviewedEmail(sendInput);
        if (!result.ok) {
          setSendError(result.message);
          setIsSending(false);
          return;
        }
        untrackAllPreviews();
        onClose?.();
      }
    } catch {
      setSendError("The network dropped before the email could be sent. Nothing was sent.");
    } finally {
      setIsSending(false);
    }
  }

  /**
   * Backs out of the ownership dialog with nothing claimed and nothing sent —
   * the reply keeps everything that was typed.
   */
  function cancelOwnershipDialog() {
    ownershipAbortedRef.current = true;
    pendingOwnershipScheduledFor.current = undefined;
    setIsOwnershipDialogOpen(false);
  }

  /**
   * The ownership dialog's confirm: claims the client first, sends second.
   * Claim-first means a refused send strands nothing — no draft row exists
   * yet — and a 409 (someone else owns the client now) stops the send with
   * that message instead of overriding them.
   */
  async function confirmOwnershipAndSend() {
    const scheduledFor = pendingOwnershipScheduledFor.current;
    ownershipAbortedRef.current = false;
    setIsClaiming(true);
    try {
      const result = await claimClientOwnership(organisationId);
      if (!result.ok) {
        if (ownershipAbortedRef.current) return;
        setIsOwnershipDialogOpen(false);
        pendingOwnershipScheduledFor.current = undefined;
        setSendError(result.message);
        return;
      }
      setOwnershipAcceptedFor(organisationId);
      if (ownershipAbortedRef.current) return;
      setIsOwnershipDialogOpen(false);
      pendingOwnershipScheduledFor.current = undefined;
      await handleSend(scheduledFor, organisationId);
    } catch {
      setIsOwnershipDialogOpen(false);
      pendingOwnershipScheduledFor.current = undefined;
      setSendError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsClaiming(false);
    }
  }

  if (blocked) {
    return (
      <p
        className={`text-[13px] leading-[1.6] font-semibold text-stop ${className}`}
        role="alert"
      >
        {blockedReason ?? "Outreach is unavailable on this client."}
      </p>
    );
  }

  const hasAttachments = attachFlyer || stagedFiles.length > 0;
  const cannotSend =
    isAiGenerating || isSending || (!body.trim() && showAiOptions) || !body.trim();

  const attachmentItems = (
    <ul className="flex flex-wrap gap-2 pt-2 pb-1">
      {attachFlyer && (
        <li>
          <InboxAttachmentCard
            filename="180DC Sheffield - What we do.pdf"
            fileType="pdf"
            nameHref="/api/outreach-flyer"
            title="Sent with every introductory email. Turn it off under More options."
            action={
              <button
                type="button"
                aria-label="Do not attach the 180DC flyer"
                onClick={() => setAttachFlyer(false)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper-sunk hover:text-red-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            }
          />
        </li>
      )}
      {stagedFiles.map((file, index) => (
        <li key={`${file.name}-${index}`}>
          <InboxAttachmentCard
            filename={file.name}
            fileType={attachmentFileTypeFromFilename(file.name)}
            sizeLabel={formatFileSize(file.size)}
            nameHref={stagedPreviews[stagedFileKey(file)] ?? null}
            action={
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => removeStagedFile(index)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper-sunk hover:text-red-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            }
          />
        </li>
      ))}
    </ul>
  );

  return (
    <section aria-labelledby="reply-composer-heading" className={className}>

      {draft?.newsSource === "live" && draft?.newsUrl && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-inset border border-rule bg-paper px-3 py-2 text-[12px] text-dim">
          <div className="flex min-w-0 items-center gap-1.5 truncate">
            <span className="shrink-0 font-medium text-ink">News story:</span>
            <a
              href={draft.newsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-lead hover:underline truncate"
            >
              {draft.newsHook ?? draft.newsUrl}
            </a>
          </div>
          <button
            type="button"
            onClick={() => void generate({ skipNews: true })}
            disabled={isAiGenerating}
            className="shrink-0 font-medium text-dim transition-colors hover:text-stop cursor-pointer"
          >
            Rewrite without news
          </button>
        </div>
      )}

      {warning && (
        <p
          className={`mt-3 text-[13px] leading-[1.6] font-semibold ${
            warning.tone === "conflict" ? "text-hold" : "text-stop"
          }`}
          role="alert"
        >
          {warning.text}
        </p>
      )}

      {error && !isAiGenerating && (
        <div className="mt-3 rounded-inset bg-stop-wash p-3" role="alert">
          <p className="text-sm font-semibold text-stop">{error}</p>
          <button
            className="mt-2 rounded-inset border border-stop/25 px-3 py-1 text-xs font-semibold text-stop cursor-pointer"
            onClick={() => void generate()}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {isAiGenerating ? (
        <div className="pt-3 pb-2 min-h-[140px]" aria-label="Drafting">
          <AiThinkingState
            stage={replyStream.displayStage}
            startedAt={replyStream.startedAt}
            heading="Drafting"
            steps={REPLY_THINKING_STEPS}
          />
          {replyStream.displayStage === "done" && stagedGenerated && (
            <StreamingDraftText
              subject=""
              body={stagedGenerated.body}
              streaming={false}
              onRevealComplete={commitStagedGenerated}
            />
          )}
        </div>
      ) : showAiOptions ? (
        <div className="mt-3">
          <AiSettingsPicker
            disabled={isAiGenerating}
            settings={aiSettings}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={isAiGenerating}
                  onMouseEnter={() => setAiHover(true)}
                  onMouseLeave={() => setAiHover(false)}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-lead px-4 py-2 text-[12px] font-bold text-white shadow-[0_12px_28px_-12px_rgba(35,64,122,0.75)] transition-colors hover:bg-[#1b3160] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  <LoaderPinwheel animate={aiHover} size={14} aria-hidden="true" />
                  Generate reply
                </button>
                <button
                  type="button"
                  onClick={handleDraftManually}
                  disabled={isAiGenerating}
                  className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-900/10 bg-white/80 px-3 py-2 text-[12px] font-semibold text-slate-700 shadow-xs backdrop-blur-sm transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-40"
                >
                  <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
                  Draft manually
                </button>
              </>
            }
          />
        </div>
      ) : (
        <div className="relative mt-3 min-h-[140px] pt-1 pb-2">
          <textarea
            ref={bodyInputRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your reply…"
            spellCheck={spellCheckOn}
            autoCapitalize="sentences"
            className="w-full min-h-[120px] text-[13px] text-slate-800 placeholder:text-slate-400 border-0 bg-transparent focus:outline-none focus:ring-0 resize-none p-0 leading-6 font-sans"
          />
          {body.length === 0 && (
            <button
              type="button"
              onClick={() => setShowAiOptions(true)}
              onMouseEnter={() => setDraftPillHover(true)}
              onMouseLeave={() => setDraftPillHover(false)}
              className="absolute left-0 top-10 flex items-center gap-1.5 rounded-full border border-slate-900/10 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-900/20 hover:text-slate-900 hover:shadow-sm transition-all cursor-pointer"
            >
              <LoaderPinwheel animate={draftPillHover} size={14} className="text-lead" />
              Use AI to draft
            </button>
          )}
        </div>
      )}

      {!isAiGenerating && hasAttachments && (
        <div className="mt-2">{attachmentItems}</div>
      )}

      {attachError && (
        <p className="mt-2 text-[11px] font-semibold text-stop" role="alert">
          {attachError}
        </p>
      )}

      {sendError && (
        <p className="mt-2 text-[11px] font-semibold text-stop" role="alert">
          {sendError}
        </p>
      )}

      {/* Bottom Action Bar — matching compose modal */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-900/8 pt-3">
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative flex items-stretch shrink-0">
            <SendButton
              disabled={cannotSend}
              label={isSending ? "Sending…" : "Send"}
              onClick={() => void handleSend()}
              pending={isSending}
              pendingLabel="Preparing…"
              title={cannotSend ? "Write a message before sending" : "Send reply"}
              tone="lead"
              radius="lg"
              className="!h-9 rounded-r-none pr-3 pl-4 text-[13px]"
            />
            <span aria-hidden="true" className="my-1.5 w-px bg-slate-900/20" />
            <Hint label="More send options">
              <button
                type="button"
                onClick={() => setIsScheduleMenuOpen((open) => !open)}
                disabled={cannotSend}
                aria-haspopup="menu"
                aria-expanded={isScheduleMenuOpen}
                aria-label="More send options"
                className="flex h-9 w-8 items-center justify-center rounded-r-lg bg-lead text-white ring-1 ring-white/20 shadow-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition-colors hover:bg-[#1b3160] disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${
                    isScheduleMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </Hint>

            <AnimatePresence>
              {isScheduleMenuOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="absolute bottom-full left-0 z-40 mb-2 w-44 origin-bottom-left rounded-lg border border-slate-900/10 bg-white p-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsScheduleMenuOpen(false);
                      setIsScheduleDialogOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-body font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <CalendarClock className="h-4 w-4 text-slate-500" />
                    Schedule send
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Hint label="Draft with AI">
            <button
              type="button"
              onClick={() => setShowAiOptions((open) => !open)}
              disabled={isAiGenerating}
              onMouseEnter={() => setAiToolbarHover(true)}
              onMouseLeave={() => setAiToolbarHover(false)}
              className="p-2 rounded-full text-slate-500 hover:bg-slate-900/5 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
              aria-label="Draft with AI"
            >
              <LoaderPinwheel animate={aiToolbarHover} size={16} />
            </button>
          </Hint>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              stageFiles(event.target.files);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <Hint label="Attach files">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-full text-slate-500 hover:bg-slate-900/5 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </Hint>

          <div className="relative">
            <Hint label="More options">
              <button
                type="button"
                onClick={() => setIsKebabOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isKebabOpen}
                aria-label="More options"
                className="p-2 rounded-full text-slate-500 hover:bg-slate-900/5 hover:text-slate-800 transition-colors cursor-pointer"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </Hint>

            <AnimatePresence>
              {isKebabOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="absolute bottom-full left-0 z-40 mb-2 w-52 origin-bottom-left rounded-lg border border-slate-900/10 bg-white p-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)]"
                >
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={spellCheckOn}
                    onClick={() => setSpellCheckOn((on) => !on)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm font-body font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <SpellCheck2 className="h-4 w-4 text-slate-500" />
                      Spell check
                    </span>
                    {spellCheckOn && <Check className="h-4 w-4 text-lime-700" />}
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={attachFlyer}
                    onClick={() => setAttachFlyer((on) => !on)}
                    title="Send the one-page 180DC flyer with this email"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm font-body font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Paperclip className="h-4 w-4 text-slate-500" />
                      Attach flyer
                    </span>
                    {attachFlyer && <Check className="h-4 w-4 text-lime-700" />}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex items-center gap-1 min-w-0">
          <Hint label="Discard draft">
            <button
              type="button"
              onClick={() => void handleDiscard()}
              className="p-2 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer shrink-0"
              aria-label="Discard draft"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </Hint>
        </div>
      </div>

      <ScheduleSendDialog
        open={isScheduleDialogOpen}
        onClose={() => setIsScheduleDialogOpen(false)}
        onConfirm={async (when) => {
          await handleSend(when.toISOString());
          return true;
        }}
      />

      <TakeOwnershipDialog
        open={isOwnershipDialogOpen}
        orgName={orgName}
        claiming={isClaiming}
        onCancel={cancelOwnershipDialog}
        onConfirm={() => void confirmOwnershipAndSend()}
      />
    </section>
  );
}
