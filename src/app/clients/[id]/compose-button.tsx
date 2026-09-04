"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { History, PenLine, Sparkles } from "lucide-react";
import {
  EmailReviewPanel,
  type EmailReviewDirtyState,
} from "@/components/outreach/email-review-panel";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_TONES, EMAIL_VOICES, OPENING_APPROACHES, SIZE_TEMPLATES, SIZE_TONE_LABELS, type ClosingApproach, type EmailLength, type EmailTone, type EmailVoice, type OpeningApproach, type SizeTemplate } from "@/lib/outreach/stage-one-prompt";
import { AiLoadingState } from "@/components/ui/ai-loading-state";
import { SectionCard } from "./section-card";

type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };
type Draft = {
  id: string;
  subject: string;
  body: string;
  sizeTemplate?: string;
  recipientOnFile: string | null;
  // The recipient exactly as last persisted (F119 AC1). Undefined on a
  // freshly generated draft (nothing saved yet); set once saved or when the
  // draft was reopened from the database. Drives the regenerate-confirm
  // baseline together with recipientOnFile.
  savedRecipient?: string | null;
};
type ExistingDraft = Draft & { savedRecipient: string | null };

const STATUS_MESSAGES = [
  "Checking outreach permissions…",
  "Reading client profile…",
  "Drafting the email…",
  "Polishing the subject line…",
];

/**
 * F126: `datetime-local` inputs speak wall-clock time in the viewer's timezone,
 * but `toISOString()` speaks UTC — using it for the picker's `min` offset the
 * earliest choosable time by the viewer's UTC offset. This renders a Date in
 * the input's own local format instead.
 */
function localDatetimeLocal(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

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
  // Regeneration updates the same outreach_messages row in place (F111 AC2),
  // so `draft.id` does not change and cannot key the review panel's remount.
  // This does, incremented on every successful (re)generate, so the panel
  // reinitializes with the new content instead of keeping edits to the old.
  const [generation, setGeneration] = useState(0);
  // F123's reviewed content lives inside EmailReviewPanel, which owns it along
  // with the approval gate and the send/save/schedule/discard actions. All this
  // side needs back is whether regenerating would throw work away — reported
  // through onDirtyChange into this ref, read only inside `generate`. A ref
  // rather than state: nothing here re-renders on an edit, and making it state
  // would re-render the whole card on every keystroke in the editor.
  const dirty = useRef<EmailReviewDirtyState | null>(null);
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
    // F116: an edited recipient counts as "something to lose" too — the confirm
    // must fire before regeneration resets it. The saved recipient is the clean
    // baseline once persisted (F119), falling back to the on-file address.
    if (
      draft &&
      dirty.current &&
      (dirty.current.recipient !== (draft.savedRecipient ?? draft.recipientOnFile ?? "") ||
        dirty.current.subject !== draft.subject ||
        dirty.current.bodyEdited)
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
      // Bumping `generation` remounts EmailReviewPanel, which is what resets
      // the reviewed content, the approval checkbox and any send message —
      // the panel initialises all of them from the draft it is handed.
      setDraft(payload as Draft);
      setGeneration((current) => current + 1);
      dirty.current = null;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const historyLink = historyHref && (
    <Link
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-rule px-4 py-2 text-xs font-semibold text-lead transition-colors hover:bg-lead-wash"
      href={historyHref}
    >
      <History aria-hidden="true" className="h-3.5 w-3.5" />
      History
    </Link>
  );

  if (blocked || ownershipBlocked) {
    return (
      <SectionCard
        action={historyLink}
        headingId="stage-one-heading"
        hint="AI-generated outreach draft, for CAM review before sending"
        icon={<PenLine />}
        title="Introductory email"
        tone="danger"
      >
        <p
          className={`mt-4 text-[13px] font-semibold leading-[1.6] ${warning?.tone === "conflict" ? "text-hold" : "text-stop"}`}
          role="alert"
        >
          {warning?.text}
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      action={
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(draft || error) && !busy && (
            <button
              className="shrink-0 rounded-full border border-rule px-4 py-2 text-xs font-semibold text-lead transition-colors hover:bg-lead-wash"
              onClick={generate}
              type="button"
            >
              Regenerate
            </button>
          )}
          {historyLink}
        </div>
      }
      headingId="stage-one-heading"
      hint="AI-generated outreach draft, for CAM review before sending"
      icon={<PenLine />}
      title="Introductory email"
    >

      <div className="mt-4 space-y-3">
        <p className="text-xs text-dim" aria-live="polite">
          {hasSavedBooklet
            ? "The client's saved booklet is included as additional context."
            : "Generate the client booklet first to include its insights in this email."}
        </p>
        <label className="block max-w-xs text-xs font-semibold text-dim">
          Email length
          <select
            className="mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm disabled:opacity-60"
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
          <span className="mt-1 block font-normal text-dim">How long the email body should be.</span>
        </label>
        <label className="block max-w-xs text-xs font-semibold text-dim">
          Closing approach
          <select className="mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm disabled:opacity-60" disabled={busy} onChange={(event) => setClosing(event.target.value as ClosingApproach)} value={closing}>
            {CLOSING_APPROACHES.map((value) => (
              <option key={value} value={value}>
                {CLOSING_APPROACH_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block max-w-xs text-xs font-semibold text-dim">
          Opening approach
          <select className="mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm disabled:opacity-60" disabled={busy} onChange={(event) => setOpening(event.target.value as OpeningApproach)} value={opening}>
            {OPENING_APPROACHES.map((value) => (
              <option key={value} value={value}>
                {OPENING_APPROACH_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block max-w-xs text-xs font-semibold text-dim">
          Email tone
          <select className="mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm disabled:opacity-60" disabled={busy} onChange={(event) => setTone(event.target.value as EmailTone)} value={tone}>
            {EMAIL_TONES.map((value) => (
              <option key={value} value={value}>
                {EMAIL_TONE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-dim">
            How friendly or formal the email reads — separate from its length and voice.
          </span>
        </label>
        <label className="block max-w-xs text-xs font-semibold text-dim">
          Email voice
          <select
            className="mt-1 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm disabled:opacity-60"
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
          <span className="mt-1 block font-normal text-dim">Who the email is written as — our collective style or plainer wording.</span>
        </label>
      </div>

      {warning && (
        <p
          className={`mt-4 text-[13px] font-semibold leading-[1.6] ${warning.tone === "conflict" ? "text-hold" : "text-stop"}`}
          role="alert"
        >
          {warning.text}
        </p>
      )}

      {!draft && !busy && !error && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-inset border border-dashed border-brand/25 bg-white/60 px-6 py-8 text-center">
          <p className="max-w-sm text-sm text-dim">
            Generate a personalised introductory email from this client&rsquo;s profile.
          </p>
          <button
            className="flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
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
        <div className="mt-5 rounded-inset bg-stop-wash p-3" role="alert">
          <p className="text-sm font-semibold text-stop">{error}</p>
          <button
            className="mt-2 rounded-inset border border-stop/25 px-3 py-1 text-xs font-semibold text-stop"
            onClick={generate}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {draft && !busy && (
        /* key={generation}: a regeneration updates the same outreach_messages
           row in place (F111 AC2), so draft.id cannot key this — the counter
           can, and remounting is what clears the previous draft's edits and
           un-ticks the approval box. */
        <EmailReviewPanel
          className="mt-5"
          description="Saved as a draft. Review and edit it, then approve below to send it from the branch mailbox."
          draft={draft}
          heading="Review generated draft"
          key={generation}
          meta={`Size tone template: ${sizeTemplateLabel(draft.sizeTemplate)}`}
          onDirtyChange={(state) => {
            dirty.current = state;
          }}
          onDraftCleared={() => {
            setDraft(null);
            dirty.current = null;
          }}
          onDraftSaved={({ recipient, subject, body }) => {
            // Sync the whole saved state — including the recipient (F119 AC1) —
            // so the regenerate-confirm baselines treat this draft as clean.
            setDraft((current) =>
              current ? { ...current, subject, body, savedRecipient: recipient } : current,
            );
          }}
          organisationId={organisationId}
        />
      )}
    </SectionCard>
  );
}
