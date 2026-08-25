"use client";

import { useState } from "react";
import Link from "next/link";
import { History, Sparkles } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import { RichTextEmailEditor } from "@/components/rich-text-email-editor";
import { saveEmailDraft, sendReviewedEmail } from "./outreach-actions";
import { validateClientEmail } from "@/lib/client-email-validation";
import { emailHtmlToPlainText, isRichEmailHtml, plainTextToEditorHtml } from "@/lib/outreach/email-html";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_TONES, EMAIL_VOICES, OPENING_APPROACHES, SIZE_TEMPLATES, SIZE_TONE_LABELS, type ClosingApproach, type EmailLength, type EmailTone, type EmailVoice, type OpeningApproach, type SizeTemplate } from "@/lib/outreach/stage-one-prompt";
import { AiLoadingState } from "@/components/ui/ai-loading-state";

type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };
type Draft = { id: string; subject: string; body: string; sizeTemplate?: string; recipientOnFile: string | null };
type ExistingDraft = { id: string; subject: string; body: string; recipientOnFile: string | null };

/**
 * F119: a saved draft's body may already be sanitized editor HTML (if it was
 * saved after this feature shipped) or still the model's plain text (an AI
 * draft that was never saved, or one saved before this feature existed) —
 * `isRichEmailHtml` tells them apart the same way outreach-history.tsx does,
 * so either shape opens correctly in the rich editor.
 */
function hydrateBody(raw: string): string {
  return isRichEmailHtml(raw) ? raw : plainTextToEditorHtml(raw);
}

const STATUS_MESSAGES = [
  "Checking outreach permissions…",
  "Reading client profile…",
  "Drafting the email…",
  "Polishing the subject line…",
];

const EMAIL_LENGTH_LABELS: Record<EmailLength, string> = {
  short: "Short",
  standard: "Standard",
  detailed: "Detailed",
};

const EMAIL_VOICE_LABELS: Record<EmailVoice, string> = {
  "180dc": "180DC Sheffield",
  consultative: "Consultative",
  plain_language: "Plain language",
};

const EMAIL_TONE_LABELS: Record<EmailTone, string> = {
  balanced: "Balanced",
  warm: "Warm",
  formal: "Formal",
  concise: "Concise",
};

const OPENING_APPROACH_LABELS: Record<OpeningApproach, string> = {
  mission_led: "Mission-led",
  direct_intro: "Direct introduction",
  news_hook: "Relevant news hook",
};

const CLOSING_APPROACH_LABELS: Record<ClosingApproach, string> = {
  soft_cta: "Soft invitation",
  meeting_request: "Request a short call",
  open_question: "Open question",
};

function sizeTemplateLabel(sizeTemplate: string | undefined): string {
  return sizeTemplate && SIZE_TEMPLATES.includes(sizeTemplate as SizeTemplate)
    ? SIZE_TONE_LABELS[sizeTemplate as SizeTemplate]
    : SIZE_TONE_LABELS.default;
}

/**
 * F019 (#22): a client owned by another CAM is visible in full, but its
 * outreach actions are not available — the button is dead on arrival rather
 * than clickable-then-refused. `blocked` stays the harder state (suppression);
 * `ownershipBlocked` renders the same disabled shape in the softer conflict
 * tone. The server-side preflight behind `generate()` still re-checks both,
 * so this is presentation over an enforcement that does not depend on it.
 *
 * F100 creates a review draft only, after the current outreach preflight passes.
 *
 * F103: `hasSavedBooklet` comes from the server page (does a saved booklet exist in
 * client_booklets?) and only drives the hint text — the route itself re-reads the
 * saved booklet, so the hint can never promise more than generation will use.
 *
 * F111 (#108) regenerates in place — same card, same draft row, new content.
 * Styled to match BookletPanel (booklet-panel.tsx), the app's other one-shot
 * Gemini-backed action: same brand-tinted card, same dashed empty-state box with
 * a prominent CTA, same small header pill once a result exists to regenerate.
 *
 * `historyHref`, when provided, links to this client's slice of
 * /admin/ai-generations (F112 AC3's "accessible without direct database access"
 * — this is the shortcut so nobody has to be walked through "go to the admin
 * dashboard, open AI generation history, then find this client"). Only ever
 * passed by page.tsx when the viewer actually has permission to land there —
 * always shown regardless of local draft state.
 *
 * F119: `existingDraft`, when page.tsx found one, hydrates the review section
 * on first render so a CAM reopening this client sees exactly what they last
 * saved instead of a blank editor — see `saveDraft` below for the write side.
 */
export function ComposeButton({
  blocked,
  ownershipBlocked = false,
  organisationId,
  suppressionReason,
  ownershipWarning,
  hasSavedBooklet = false,
  historyHref,
  existingDraft = null,
}: {
  blocked: boolean;
  ownershipBlocked?: boolean;
  organisationId: string;
  suppressionReason?: string;
  ownershipWarning?: string;
  hasSavedBooklet?: boolean;
  historyHref?: string;
  existingDraft?: ExistingDraft | null;
}) {
  const [draft, setDraft] = useState<Draft | null>(
    existingDraft ? { ...existingDraft, sizeTemplate: undefined } : null,
  );
  // F123: the reviewed content is what actually gets sent, and any edit resets
  // approval. These also drive F111's regenerate-confirm (edits vs draft).
  const [recipient, setRecipient] = useState(existingDraft?.recipientOnFile ?? "");
  const [subject, setSubject] = useState(existingDraft?.subject ?? "");
  // F117: HTML from the rich-text editor, not plain text — compared against
  // `hydrateBody(draft.body)` (the same representation, whichever shape it's
  // actually in), never against `draft.body` directly, or every fresh draft
  // would look "edited" the instant it loads.
  const [body, setBody] = useState(existingDraft ? hydrateBody(existingDraft.body) : "");
  // Regeneration updates the same outreach_messages row in place (F111 AC2),
  // so `draft.id` does not change and cannot key the editor's remount. This
  // does, incremented on every successful (re)generate, forcing the
  // uncontrolled editor to reinitialize with the new content.
  const [generation, setGeneration] = useState(0);
  const [approved, setApproved] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<Warning | null>(
    blocked
      ? {
          text: `This client is suppressed. Outreach is blocked. Reason: ${suppressionReason ?? "No reason was recorded."}`,
          tone: "block",
        }
      : ownershipBlocked || ownershipWarning
        ? { text: ownershipWarning ?? "Outreach is unavailable on this client.", tone: "conflict" }
        : null,
  );
  const [length, setLength] = useState<EmailLength>("standard");
  const [voice, setVoice] = useState<EmailVoice>("180dc");
  const [tone, setTone] = useState<EmailTone>("balanced");
  const [opening, setOpening] = useState<OpeningApproach>("mission_led");
  const [closing, setClosing] = useState<ClosingApproach>("soft_cta");

  async function generate() {
    // F111 — Regenerate Email Draft (#108), "Important usability": regenerating
    // replaces the visible draft outright (AC2), which would silently throw away
    // any edits the CAM already made to it. Confirm first, but only when there's
    // actually something to lose.
    if (
      draft &&
      (recipient !== (draft.recipientOnFile ?? "") ||
        subject !== draft.subject ||
        body !== hydrateBody(draft.body))
    ) {
      if (!window.confirm("Regenerating will replace this draft and discard your edits. Continue?")) {
        return;
      }
    }

    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const preflight = await fetch(`/api/clients/${organisationId}/outreach-preflight`, {
        method: "POST",
      });
      const preflightBody = await preflight.json();
      if (!preflight.ok || !preflightBody.allowed) {
        setWarning({
          text: preflightBody.error ?? "Outreach permissions could not be verified. Nothing was sent.",
          tone: preflightBody.kind === "ownership_conflict" ? "conflict" : "block",
        });
        return;
      }

      const response = await fetch(`/api/clients/${organisationId}/outreach-drafts/stage-one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(draft ? { draftId: draft.id } : {}),
          length,
          voice,
          tone,
          opening,
          closing,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "The email draft could not be generated. Try again.");
        // A 409 means the draft this session was tracking no longer exists as one
        // (sent or removed elsewhere) — drop it so "Try again" starts a fresh draft
        // instead of retrying an update that can only ever fail the same way.
        if (response.status === 409) setDraft(null);
        return;
      }
      const nextDraft = payload as Draft;
      setDraft(nextDraft);
      setRecipient(nextDraft.recipientOnFile ?? "");
      setSubject(nextDraft.subject);
      setBody(plainTextToEditorHtml(nextDraft.body));
      setGeneration((current) => current + 1);
      setApproved(false);
      setSendMessage(null);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!draft) return;
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
    setSendMessage(result.message);
    if (result.ok) setDraft(null);
    setSending(false);
  }

  /**
   * F119: saves the reviewed content without sending. Unlike `send`, this
   * keeps the draft open for further editing — it updates `draft` to the
   * just-saved subject/body so the regenerate-confirm dirty check treats
   * a saved-and-unchanged draft as clean, not as edits about to be lost.
   */
  async function saveDraft() {
    if (!draft) return;
    setSavingDraft(true);
    setSaveMessage(null);
    const result = await saveEmailDraft({
      organisationId,
      messageId: draft.id,
      subject,
      body,
    });
    setSaveMessage(result.message);
    if (result.ok) {
      setDraft((current) => (current ? { ...current, subject, body } : current));
    }
    setSavingDraft(false);
  }

  const historyLink = historyHref && (
    <Link
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand/30 px-4 py-2 text-xs font-bold text-brand transition-colors hover:bg-brand/10"
      href={historyHref}
    >
      <History aria-hidden="true" className="h-3.5 w-3.5" />
      History
    </Link>
  );

  if (blocked || ownershipBlocked) {
    return (
      <section
        aria-labelledby="outreach-heading"
        className="overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.05] via-white to-white p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-800">
              <Sparkles aria-hidden="true" className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-bold" id="outreach-heading">Stage 1 email</h2>
              <p className="text-xs text-foreground/55">AI-generated outreach draft, for CAM review before sending</p>
            </div>
          </div>
          {historyLink}
        </div>
        <p
          className={`mt-4 text-[13px] font-bold leading-[1.6] ${warning?.tone === "conflict" ? "text-amber-800" : "text-red-800"}`}
          role="alert"
        >
          {warning?.text}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="outreach-heading"
      className="overflow-hidden rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.07] via-white to-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/15 text-brand-hover">
            <Sparkles aria-hidden="true" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-bold" id="outreach-heading">Stage 1 email</h2>
            <p className="text-xs text-foreground/55">AI-generated outreach draft, for CAM review before sending</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(draft || error) && !busy && (
            <button
              className="shrink-0 rounded-full border border-brand/30 px-4 py-2 text-xs font-bold text-brand transition-colors hover:bg-brand/10"
              onClick={generate}
              type="button"
            >
              Regenerate
            </button>
          )}
          {historyLink}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <p className="text-xs text-foreground/55" aria-live="polite">
          {hasSavedBooklet
            ? "The client's saved booklet is included as additional context."
            : "Generate the client booklet first to include its insights in this email."}
        </p>
        <label className="block max-w-xs text-xs font-bold text-foreground/65">
          Email length
          <select
            className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60"
            disabled={busy}
            onChange={(event) => setLength(event.target.value as EmailLength)}
            value={length}
          >
            {EMAIL_LENGTHS.map((value) => (
              <option key={value} value={value}>
                {EMAIL_LENGTH_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-foreground/55">How long the email body should be.</span>
        </label>
        <label className="block max-w-xs text-xs font-bold text-foreground/65">
          Closing approach
          <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60" disabled={busy} onChange={(event) => setClosing(event.target.value as ClosingApproach)} value={closing}>
            {CLOSING_APPROACHES.map((value) => (
              <option key={value} value={value}>
                {CLOSING_APPROACH_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block max-w-xs text-xs font-bold text-foreground/65">
          Opening approach
          <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60" disabled={busy} onChange={(event) => setOpening(event.target.value as OpeningApproach)} value={opening}>
            {OPENING_APPROACHES.map((value) => (
              <option key={value} value={value}>
                {OPENING_APPROACH_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block max-w-xs text-xs font-bold text-foreground/65">
          Email tone
          <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60" disabled={busy} onChange={(event) => setTone(event.target.value as EmailTone)} value={tone}>
            {EMAIL_TONES.map((value) => (
              <option key={value} value={value}>
                {EMAIL_TONE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-foreground/55">
            How friendly or formal the email reads — separate from its length and voice.
          </span>
        </label>
        <label className="block max-w-xs text-xs font-bold text-foreground/65">
          Email voice
          <select
            className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60"
            disabled={busy}
            onChange={(event) => setVoice(event.target.value as EmailVoice)}
            value={voice}
          >
            {EMAIL_VOICES.map((value) => (
              <option key={value} value={value}>
                {EMAIL_VOICE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-foreground/55">Who the email is written as — our collective style or plainer wording.</span>
        </label>
      </div>

      {warning && (
        <p
          className={`mt-4 text-[13px] font-bold leading-[1.6] ${warning.tone === "conflict" ? "text-amber-800" : "text-red-800"}`}
          role="alert"
        >
          {warning.text}
        </p>
      )}

      {!draft && !busy && !error && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-brand/25 bg-white/60 px-6 py-8 text-center">
          <p className="max-w-sm text-sm text-foreground/65">
            Generate a personalised Stage 1 outreach email from this client&rsquo;s profile.
          </p>
          <button
            className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            onClick={generate}
            type="button"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Generate Stage 1 email
          </button>
        </div>
      )}

      {busy && (
        <AiLoadingState
          messages={STATUS_MESSAGES}
          reducedMotionLabel="Generating the draft — this can take several seconds…"
        />
      )}

      {error && !busy && (
        <div className="mt-5 rounded-lg bg-red-50 p-3" role="alert">
          <p className="text-sm font-bold text-red-800">{error}</p>
          <button
            className="mt-2 rounded-lg border border-red-800/20 px-3 py-1 text-xs font-bold text-red-800"
            onClick={generate}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {draft && !busy && (() => {
        const recipientValidation = validateClientEmail(recipient);
        const recipientMismatch =
          recipientValidation.status === "valid" &&
          Boolean(draft.recipientOnFile) &&
          recipientValidation.value !== draft.recipientOnFile!.trim().toLowerCase();
        return (
        <div className="mt-5 space-y-3">
          <div>
            <h3 className="text-sm font-bold" id="email-review-heading">Review generated draft</h3>
            <p className="mt-1 text-xs text-foreground/55">
              Saved as a draft. Review and edit it, then approve below to send it from the branch mailbox.
            </p>
            <p className="mt-1 text-xs text-foreground/65">
              Size tone template: {sizeTemplateLabel(draft.sizeTemplate)}
            </p>
          </div>
          <label className="block text-xs font-bold text-foreground/65">
            Recipient
            <input
              aria-describedby={recipientValidation.status !== "valid" ? "recipient-error" : recipientMismatch ? "recipient-mismatch-warning" : undefined}
              aria-invalid={recipientValidation.status !== "valid"}
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
              onChange={(event) => { setRecipient(event.target.value); setApproved(false); }}
              value={recipient}
            />
          </label>
          {/* F116 AC2: same format rule F045 uses (validateClientEmail), reused
              client-side so the CAM sees this before ever attempting to send —
              send-reviewed.ts enforces the identical rule server-side regardless. */}
          {recipientValidation.status !== "valid" && (
            <p className="text-xs font-bold text-red-800" id="recipient-error" role="alert">
              {recipientValidation.message}
            </p>
          )}
          {/* F116 AC3: advisory only, not a block — a CAM may deliberately send to
              an address other than the one on file (e.g. a different contact). */}
          {recipientMismatch && (
            <p className="text-xs font-bold text-amber-800" id="recipient-mismatch-warning" role="alert">
              This doesn&rsquo;t match the client&rsquo;s email on file ({draft.recipientOnFile}). Double-check before sending.
            </p>
          )}
          <label className="block text-xs font-bold text-foreground/65">
            Subject
            <input
              aria-describedby={subject.trim() ? undefined : "subject-error"}
              aria-invalid={!subject.trim()}
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
              onChange={(event) => { setSubject(event.target.value); setApproved(false); }}
              value={subject}
            />
          </label>
          {/* F115 AC2: the Send button already stays disabled with an empty subject
              (see below) — this makes *why* visible instead of a silently inert
              button, using the same wording send-reviewed.ts's server-side check
              would give if this were ever bypassed. */}
          {!subject.trim() && (
            <p className="text-xs font-bold text-red-800" id="subject-error" role="alert">
              Add a subject before sending.
            </p>
          )}
          <div>
            <p className="text-xs font-bold text-foreground/65" id="email-body-heading">
              Body
            </p>
            {/* key={generation}: forces the uncontrolled editor to reinitialize
                with the new draft's content — draft.id cannot be used here, since
                a regeneration updates the same row in place (F111 AC2). */}
            <div className="mt-1">
              <RichTextEmailEditor
                ariaLabelledBy="email-body-heading"
                disabled={busy}
                initialContent={body}
                key={generation}
                onChange={(html) => {
                  setBody(html);
                  setApproved(false);
                }}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs font-bold text-foreground/70">
            <input checked={approved} className="mt-0.5" onChange={(event) => setApproved(event.target.checked)} type="checkbox" />
            I have reviewed the recipient, subject and body and approve this email for sending.
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {/* F119: saving has none of sending's requirements — no approval
                checkbox, no valid recipient, not even a non-empty subject or
                body — a work-in-progress draft is exactly what this is for. */}
            <OriginButton disabled={savingDraft || sending} onClick={saveDraft} type="button" variant="outline">
              {savingDraft ? "Saving…" : "Save draft"}
            </OriginButton>
            <OriginButton
              disabled={
                !approved ||
                sending ||
                recipientValidation.status !== "valid" ||
                !subject.trim() ||
                emailHtmlToPlainText(body).length === 0
              }
              onClick={send}
              type="button"
            >
              {sending ? "Sending…" : "Send reviewed email"}
            </OriginButton>
          </div>
          {saveMessage && (
            <p className="text-xs font-bold text-foreground/65" role="status">
              {saveMessage}
            </p>
          )}
          <p className="text-xs font-bold text-amber-800" role="status">
            {sendMessage ?? "Not sent — explicit human review and send are required."}
          </p>
        </div>
        );
      })()}
    </section>
  );
}
