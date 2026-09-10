"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import {
  ScheduleSendDialog,
  formatScheduleLong,
} from "@/components/outreach/schedule-send-dialog";
import { ConfirmSendDialog } from "@/components/outreach/confirm-send-dialog";
import { SendButton } from "@/components/ui/send-button";
import { RichTextEmailEditor } from "@/components/rich-text-email-editor";
import { validateClientEmail } from "@/lib/client-email-validation";
import { emailHtmlToPlainText, isRichEmailHtml, plainTextToEditorHtml } from "@/lib/outreach/email-html";
import { AttachmentPicker } from "@/app/clients/[id]/attachment-picker";
import type { Attachment } from "@/lib/attachments";
import {
  discardEmailDraft,
  saveEmailDraft,
  scheduleReviewedEmail,
  sendReviewedEmail,
} from "@/app/clients/[id]/outreach-actions";

/**
 * The review-and-send half of an outreach draft: recipient, subject, body,
 * the approval gate, and the four actions behind it (save, send, schedule,
 * discard).
 *
 * Extracted from compose-button.tsx so the inbox thread view can reply from
 * inside the thread without a second copy of this UI. That mattered less for
 * the markup than for the *gates*: F115's empty-subject block, F116's
 * recipient validation and on-file mismatch warning, and F123's "any edit
 * resets approval" rule are all enforced here, once. A fork would have meant
 * two places to fix the next approval-gate bug, and only one of them getting
 * fixed.
 *
 * The server actions it calls are the approved send path (PRD §12.1 — Gmail
 * API on the CAM's own authorised account). They re-check suppression,
 * ownership, rate limits and human review regardless of which surface called
 * them, so mounting this in a second place widens the UI, not the trust
 * boundary.
 *
 * State ownership: this component owns the reviewed content; the parent owns
 * the draft row and generation. A parent that regenerates should bump `key` so
 * this remounts with the new draft rather than keeping edits to the old one —
 * that is how compose-button.tsx's `generation` counter works.
 */

export type EmailReviewDraft = {
  id: string;
  subject: string;
  body: string;
  /** The client's email as held on the record, for the mismatch warning. */
  recipientOnFile: string | null;
  /**
   * The recipient exactly as last persisted (F119 AC1). Undefined on a freshly
   * generated draft (nothing saved yet).
   */
  savedRecipient?: string | null;
  /**
   * F110: live news hook behind this draft, when the Stage 2 route found one.
   * Present only on freshly generated drafts. A reopened draft restores these
   * from its outreach_messages row (news_source/news_hook/news_url) through
   * the inbox resume path instead. Absent means no hook, never a hidden one:
   * the panel only renders the source line for a verifiable live URL.
   */
  newsSource?: "live" | "stored" | "none";
  newsHook?: string | null;
  newsUrl?: string | null;
};

/** What the parent needs to decide whether regenerating would lose work. */
export type EmailReviewDirtyState = {
  recipient: string;
  subject: string;
  bodyEdited: boolean;
};

/**
 * F119: a saved draft's body may already be sanitized editor HTML (if it was
 * saved after that feature shipped) or still the model's plain text (an AI
 * draft that was never saved, or one saved before it existed) —
 * `isRichEmailHtml` tells them apart the same way outreach-history.tsx does,
 * so either shape opens correctly in the rich editor.
 */
export function hydrateEmailBody(raw: string): string {
  return isRichEmailHtml(raw) ? raw : plainTextToEditorHtml(raw);
}

export function EmailReviewPanel({
  organisationId,
  draft,
  heading,
  description,
  meta,
  idPrefix = "email-review",
  className = "",
  onDirtyChange,
  onDraftCleared,
  onCommitted,
  onDraftSaved,
  clientAttachments = [],
  initialScheduledAt = null,
}: {
  organisationId: string;
  draft: EmailReviewDraft;
  /**
   * Files already on the client record, offered for attaching (F217). Empty by
   * default so a surface with nothing to attach need not pass it.
   */
  clientAttachments?: readonly Attachment[];
  heading: string;
  description: string;
  /** Optional line under the description — e.g. the size-tone template used. */
  meta?: string;
  /** Namespaces the aria ids, so two panels could coexist on one page. */
  idPrefix?: string;
  className?: string;
  /** Fires whenever the reviewed content diverges from the generated draft. */
  onDirtyChange?: (state: EmailReviewDirtyState) => void;
  /** Sent or discarded — the draft row is gone and the parent should clear it. */
  onDraftCleared?: () => void;
  /**
   * Sent or scheduled, successfully. `onDraftCleared` fires for a discard too,
   * so a caller that wants to say "sent — view it in the inbox" cannot use it:
   * it cannot tell a delivered email from a thrown-away one. This can.
   */
  onCommitted?: (result: { kind: "sent" | "scheduled"; scheduledFor?: string }) => void;
  /** Saved without sending — the parent's dirty baseline should move up to here. */
  onDraftSaved?: (saved: { recipient: string; subject: string; body: string }) => void;
  /**
   * An instant the caller already asked to schedule for, as ISO.
   *
   * The inbox compose window has its own schedule dialog in front of this
   * panel, and that time used to be discarded on arrival: the CAM picked a
   * time, was told "Scheduled for …", and then had to find "Schedule for
   * later" in here and pick the same time a second time. Passing it here makes
   * the panel commit to that time instead — the primary action becomes
   * Schedule send, behind the identical approval gate, and "Schedule for
   * later" stays available for changing it.
   */
  initialScheduledAt?: string | null;
}) {
  const [recipient, setRecipient] = useState(
    draft.savedRecipient ?? draft.recipientOnFile ?? "",
  );
  const [subject, setSubject] = useState(draft.subject);
  // F117: HTML from the rich-text editor, not plain text.
  const [body, setBody] = useState(() => hydrateEmailBody(draft.body));
  // Tracks whether the editor has actually fired an update since this draft
  // loaded. The parent's regenerate-confirm uses this instead of comparing live
  // editor HTML against the hydrated draft, because Tiptap's serializer can
  // differ cosmetically from that hydration output — a string comparison could
  // prompt "discard your edits?" even when nothing changed.
  const [bodyEdited, setBodyEdited] = useState(false);
  const [approved, setApproved] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  // F129: distinguishes a failed send attempt (red alert) from the standing
  // "not sent yet" notice (amber).
  const [sendFailed, setSendFailed] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  // F126: the schedule dialog picks the time; this only tracks whether it is
  // open, and whether a chosen time is mid-commit.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // The time this panel commits to when Schedule send is pressed. Seeded from
  // the caller's own dialog; the panel's own dialog replaces it.
  const [scheduledAt, setScheduledAt] = useState<Date | null>(
    initialScheduledAt ? new Date(initialScheduledAt) : null,
  );
  const [scheduling, setScheduling] = useState(false);
  // Send now needs a confirmation step before the Gmail call: the approval
  // checkbox is the review gate, and this is the commit gate. A stray tap on
  // the paper plane is the one send action that should ask first.
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);

  // The parent reads this to decide whether regenerating would discard work.
  // Reported through an effect rather than from each setter so it can never
  // fall out of step with the state it describes. `onDirtyChange` is in the
  // deps because it must be — the React Compiler memoizes the parent's inline
  // arrow, so this settles after the first render rather than firing on every
  // one, and a re-fire would only re-report the same values anyway.
  useEffect(() => {
    onDirtyChange?.({ recipient, subject, bodyEdited });
  }, [onDirtyChange, recipient, subject, bodyEdited]);

  async function send() {
    setSending(true);
    setSendMessage(null);
    const result = await sendReviewedEmail({
      organisationId,
      messageId: draft.id,
      recipient,
      subject,
      body,
      explicitlyApproved: approved,
    });
    // F129 AC1: a failed send is a red alert, not the amber "not sent yet"
    // default — and the draft stays open, so retrying is one click away.
    setSendFailed(!result.ok);
    setSendMessage(result.message);
    if (result.ok) {
      onCommitted?.({ kind: "sent" });
      onDraftCleared?.();
    }
    setSending(false);
  }

  /**
   * F119: saves the reviewed content without sending. Unlike `send`, this
   * keeps the draft open for further editing — it tells the parent what was
   * saved so the regenerate-confirm dirty check treats a saved-and-unchanged
   * draft as clean, not as edits about to be lost.
   */
  async function saveDraft() {
    setSavingDraft(true);
    setSaveMessage(null);
    const result = await saveEmailDraft({
      organisationId,
      messageId: draft.id,
      recipient,
      subject,
      body,
    });
    setSaveMessage(result.message);
    if (result.ok) {
      // The saved content is now durable — the regenerate-confirm must treat
      // this draft as clean, which is what clearing bodyEdited and syncing the
      // parent's baseline together achieve.
      setBodyEdited(false);
      onDraftSaved?.({ recipient, subject, body });
    }
    setSavingDraft(false);
  }

  /**
   * F120: removes the draft outright, so a confirmation step comes first
   * (AC2) — the content is genuinely gone once the action below runs, unlike
   * `saveDraft`.
   */
  async function discardDraft() {
    if (!window.confirm("Discard this draft? Its content will be lost.")) return;
    setDiscarding(true);
    setSaveMessage(null);
    const result = await discardEmailDraft({ organisationId, messageId: draft.id });
    if (result.ok) {
      onDraftCleared?.();
    } else {
      setSaveMessage(result.message);
    }
    setDiscarding(false);
  }

  // F126: same review gate as send() — the approval checkbox is required either
  // way, since scheduling is a commitment to deliver this exact content later.
  /**
   * F126: same review gate as send() — the approval checkbox is required either
   * way, since scheduling is a commitment to deliver this exact content later.
   *
   * `recipient` is passed for the same reason send() passes it: scheduleSchema
   * is reviewedEmailSchema.extend({ scheduledAt }), so the reviewed recipient
   * has always been part of the payload it validates. Omitting it made every
   * schedule attempt fail on "Add a valid recipient email address before
   * sending" — a rejection with nothing on screen to explain it, since the
   * recipient field was filled in.
   */
  async function schedule(when: Date): Promise<boolean> {
    setScheduledAt(when);
    setScheduling(true);
    setSendMessage(null);
    const result = await scheduleReviewedEmail({
      organisationId,
      messageId: draft.id,
      recipient,
      subject,
      body,
      explicitlyApproved: approved,
      scheduledAt: when.toISOString(),
    });
    setSendFailed(!result.ok);
    setSendMessage(result.message);
    setScheduling(false);
    if (!result.ok) return false;
    onCommitted?.({ kind: "scheduled", scheduledFor: when.toISOString() });
    onDraftCleared?.();
    return true;
  }

  const recipientValidation = validateClientEmail(recipient);
  // An emptied input is not the same fact as a client with no email on file:
  // say what the CAM should do, not what the record lacks.
  const recipientError =
    recipientValidation.status === "missing"
      ? "Add a recipient email address."
      : recipientValidation.status === "invalid"
        ? recipientValidation.message
        : null;
  const recipientMismatch =
    recipientValidation.status === "valid" &&
    Boolean(draft.recipientOnFile) &&
    recipientValidation.value !== draft.recipientOnFile!.trim().toLowerCase();

  const headingId = `${idPrefix}-heading`;
  const bodyHeadingId = `${idPrefix}-body-heading`;
  const recipientErrorId = `${idPrefix}-recipient-error`;
  const recipientMismatchId = `${idPrefix}-recipient-mismatch`;
  const subjectErrorId = `${idPrefix}-subject-error`;

  const contentEmpty = emailHtmlToPlainText(body).length === 0;
  const cannotCommit =
    !approved || sending || recipientValidation.status !== "valid" || !subject.trim() || contentEmpty;

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold" id={headingId}>
          {heading}
        </h3>
        <p className="mt-1 text-xs text-dim">{description}</p>
        {meta && <p className="mt-1 text-xs text-dim">{meta}</p>}
        {/* F110: the follow-up may rest on a news hook the model was given, so
            the CAM checks the source before approving — a hook without a
            verifiable URL renders nothing, and a reopened draft (whose
            news fields are gone with the transient response) stays silent
            rather than implying a hook that cannot be checked. */}
        {draft.newsSource === "live" && draft.newsUrl && (
          <p className="mt-1 text-xs text-dim">
            News hook{draft.newsHook ? `: ${draft.newsHook}` : ""} — verify the{" "}
            <a
              className="font-semibold underline"
              href={draft.newsUrl}
              rel="noreferrer"
              target="_blank"
            >
              source
            </a>
            .
          </p>
        )}
      </div>

      <label className="block text-xs font-semibold text-dim">
        Recipient
        <input
          aria-describedby={
            recipientValidation.status !== "valid"
              ? recipientErrorId
              : recipientMismatch
                ? recipientMismatchId
                : undefined
          }
          aria-invalid={recipientValidation.status !== "valid"}
          className="mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm"
          onChange={(event) => {
            setRecipient(event.target.value);
            setApproved(false);
          }}
          value={recipient}
        />
      </label>
      {/* F116 AC2: same format rule F045 uses (validateClientEmail), reused
          client-side so the CAM sees this before ever attempting to send —
          send-reviewed.ts enforces the identical rule server-side regardless. */}
      {recipientError && (
        <p className="text-xs font-semibold text-stop" id={recipientErrorId} role="alert">
          {recipientError}
        </p>
      )}
      {/* F116 AC3: advisory only, not a block — a CAM may deliberately send to
          an address other than the one on file (e.g. a different contact). */}
      {recipientMismatch && (
        <p className="text-xs font-semibold text-hold" id={recipientMismatchId} role="alert">
          This doesn&rsquo;t match the client&rsquo;s email on file ({draft.recipientOnFile}). Double-check
          before sending.
        </p>
      )}

      <label className="block text-xs font-semibold text-dim">
        Subject
        <input
          aria-describedby={subject.trim() ? undefined : subjectErrorId}
          aria-invalid={!subject.trim()}
          className="mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm"
          onChange={(event) => {
            setSubject(event.target.value);
            setApproved(false);
          }}
          value={subject}
        />
      </label>
      {/* F115 AC2: the Send button already stays disabled with an empty subject
          — this makes *why* visible instead of a silently inert button, using
          the same wording send-reviewed.ts's server-side check would give. */}
      {!subject.trim() && (
        <p className="text-xs font-semibold text-stop" id={subjectErrorId} role="alert">
          Add a subject before sending.
        </p>
      )}

      <div>
        <p className="text-xs font-semibold text-dim" id={bodyHeadingId}>
          Body
        </p>
        <div className="mt-1">
          <RichTextEmailEditor
            ariaLabelledBy={bodyHeadingId}
            initialContent={body}
            onChange={(html) => {
              setBody(html);
              setBodyEdited(true);
              setApproved(false);
            }}
          />
        </div>
      </div>

      <AttachmentPicker
        clientAttachments={clientAttachments}
        messageId={draft.id}
        organisationId={organisationId}
      />

      <label className="flex items-start gap-2 text-xs font-semibold text-dim">
        <input
          checked={approved}
          className="mt-0.5"
          onChange={(event) => setApproved(event.target.checked)}
          type="checkbox"
        />
        I have reviewed the recipient, subject and body and approve this email for sending.
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {/* F119: saving has none of sending's requirements — no approval
            checkbox, no valid recipient, not even a non-empty subject or
            body — a work-in-progress draft is exactly what this is for. */}
        <OriginButton
          disabled={savingDraft || sending || discarding}
          onClick={saveDraft}
          type="button"
          variant="outline"
        >
          {savingDraft ? "Saving…" : "Save draft"}
        </OriginButton>
        {/* The one action on this screen that actually leaves the building, so
            it is the one place the paper-plane button is spent. Everything
            beside it stays an OriginButton. */}
        {scheduledAt ? (
          /* A time is already chosen (the inbox compose window's dialog picked
             it, or this panel's own did), so the primary action commits THAT
             rather than sending now — pressing "Send reviewed email" here
             would quietly ignore the CAM's answer to "when?". */
          <SendButton
            disabled={cannotCommit || scheduling}
            label={`Schedule send · ${formatScheduleLong(scheduledAt)}`}
            onClick={() => void schedule(scheduledAt)}
            pending={scheduling}
            pendingLabel="Scheduling…"
            type="button"
          />
        ) : (
          <SendButton
            disabled={cannotCommit || sending}
            label="Send reviewed email"
            onClick={() => setConfirmSendOpen(true)}
            pending={sending}
            type="button"
          />
        )}
        {/* F120: same drafts-only reach as Save — a sent email is never
            reachable here, so there is no "discard a sent email" case to guard. */}
        <button
          className="shrink-0 rounded-full border border-stop/25 px-4 py-2 text-xs font-semibold text-stop transition-colors hover:bg-stop-wash disabled:opacity-60"
          disabled={savingDraft || sending || discarding}
          onClick={discardDraft}
          type="button"
        >
          {discarding ? "Discarding…" : "Discard draft"}
        </button>
      </div>

      {saveMessage && (
        <p className="text-xs font-semibold text-dim" role="status">
          {saveMessage}
        </p>
      )}

      {/* F126: schedule the reviewed email for later instead of sending now.
          Same approval gate as Send — a scheduled email is a commitment to
          deliver this exact content, so it cannot bypass human review.

          The dialog (shared with the inbox compose window) replaced a bare
          `datetime-local` beside a button. An instant typed into an input never
          said the thing that matters: once scheduled, the message cannot be
          edited. Its confirm step does. */}
      <div className="flex flex-wrap items-end gap-2">
        <OriginButton
          disabled={cannotCommit}
          onClick={() => setScheduleOpen(true)}
          type="button"
          variant="outline"
        >
          <CalendarClock aria-hidden="true" className="size-4" />
          {scheduledAt ? "Change the time" : "Schedule for later"}
        </OriginButton>
        {scheduledAt && (
          <OriginButton
            disabled={sending || scheduling}
            onClick={() => setScheduledAt(null)}
            type="button"
            variant="outline"
          >
            Send now instead
          </OriginButton>
        )}
      </div>

      <ScheduleSendDialog
        committing={scheduling}
        doneMessage="It will send automatically. You can cancel it from Queued and failed on the client's record before then."
        onClose={() => setScheduleOpen(false)}
        onConfirm={schedule}
        open={scheduleOpen}
      />

      <ConfirmSendDialog
        open={confirmSendOpen}
        onClose={() => setConfirmSendOpen(false)}
        onConfirm={send}
        pending={sending}
      />

      <p
        className={`text-xs font-semibold ${sendFailed ? "text-stop" : "text-hold"}`}
        role={sendFailed ? "alert" : "status"}
      >
        {sendMessage ?? "Not sent — explicit human review and send are required."}
      </p>
    </div>
  );
}
