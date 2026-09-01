"use client";

import { useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";

import { AiLoadingState } from "@/components/ui/ai-loading-state";
import { OriginButton } from "@/components/ui/origin-button";
import { EmailReviewPanel } from "@/components/outreach/email-review-panel";
import {
  CLOSING_APPROACHES,
  EMAIL_LENGTHS,
  EMAIL_TONES,
  EMAIL_VOICES,
  type ClosingApproach,
  type EmailLength,
  type EmailTone,
  type EmailVoice,
} from "@/lib/outreach/stage-one-prompt";

/**
 * Reply to a thread without leaving it (/inbox/[orgId]).
 *
 * Replaces the CTA that used to deep-link into the client page's outreach
 * section: a CAM who has just read four messages should not have to lose them
 * to answer. Generation and review are the same two halves the client page
 * uses — the stage-two endpoint and EmailReviewPanel — so nothing about the
 * send path is new here. That panel calls the approved server actions (PRD
 * §12.1, Gmail API on the CAM's own authorised account), which re-check
 * suppression, ownership, rate limits and human review server-side regardless
 * of which page called them.
 *
 * Eligibility is NOT widened for the inbox. `/api/clients/[id]/outreach-drafts/
 * stage-two` enforces `isStageTwoEligible` (outreach_status ===
 * "initial_outreach_sent"), so a drawer offered outside that window would be a
 * button whose only possible outcome is a 409. The route decides eligibility
 * server-side and renders the old deep-link instead when it fails — same rule
 * the client page's FollowUpButton follows, so the two surfaces cannot disagree
 * about when a follow-up is available.
 *
 * No existing-draft hydration, deliberately. Each generation inserts a NEW
 * outreach_messages row, and an abandoned draft row cannot be told apart from a
 * live one by status alone — page.tsx documents the mirror-image hazard on the
 * Stage 1 card. Reopening saved drafts stays a client-page job; this drawer
 * only ever edits the draft it just generated.
 */

const STATUS_MESSAGES = [
  "Checking outreach permissions…",
  "Re-reading the conversation…",
  "Drafting the reply…",
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

const CLOSING_APPROACH_LABELS: Record<ClosingApproach, string> = {
  soft_cta: "Soft invitation",
  meeting_request: "Request a short call",
  open_question: "Open question",
};

type Draft = { id: string; subject: string; body: string };
type Warning = { text: string; tone: "block" | "conflict" };

/** One labelled `select`. Four of these is the whole generation form. */
function ChoiceField<T extends string>({
  label,
  value,
  options,
  labels,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <label className="block text-xs font-bold text-foreground/65">
      {label}
      <select
        className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReplyDrawer({
  organisationId,
  recipientOnFile,
  blocked = false,
  blockedReason,
}: {
  organisationId: string;
  /** The client's email as held on the record — the mismatch-warning baseline. */
  recipientOnFile: string | null;
  /** Suppressed or owned by another CAM: the trigger renders dead, not hidden. */
  blocked?: boolean;
  blockedReason?: string;
}) {
  const [open, setOpen] = useState(false);
  // Every generation inserts a new draft row, so this id is enough to remount
  // the review panel with the new content — unlike the Stage 1 card, which
  // regenerates in place and needs a separate counter for that.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [length, setLength] = useState<EmailLength>("standard");
  const [voice, setVoice] = useState<EmailVoice>("180dc");
  const [tone, setTone] = useState<EmailTone>("balanced");
  const [closing, setClosing] = useState<ClosingApproach>("soft_cta");

  async function generate() {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      // Same preflight the client page runs before paying for a generation:
      // suppression or an ownership change can land after this page rendered.
      const preflight = await fetch(`/api/clients/${organisationId}/outreach-preflight`, {
        method: "POST",
      });
      const preflightBody = await preflight.json();
      if (!preflight.ok || !preflightBody.allowed) {
        setWarning({
          text:
            preflightBody.error ??
            "Outreach permissions could not be verified. Nothing was sent.",
          tone: preflightBody.kind === "ownership_conflict" ? "conflict" : "block",
        });
        return;
      }

      const response = await fetch(`/api/clients/${organisationId}/outreach-drafts/stage-two`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ length, voice, tone, closing }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "The reply draft could not be generated. Try again.");
        return;
      }
      setDraft(payload as Draft);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (blocked) {
    return (
      <div>
        <OriginButton disabled size="sm" type="button" variant="outline">
          Generate reply draft
        </OriginButton>
        <p className="mt-2.5 text-[13px] font-bold leading-[1.6] text-red-800" role="alert">
          {blockedReason ?? "Outreach is unavailable on this client."}
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Sparkles aria-hidden="true" className="h-4 w-4" />
        Generate reply draft
      </button>
    );
  }

  return (
    <section
      aria-labelledby="reply-drawer-heading"
      className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.07] via-white to-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/15 text-brand-hover">
            <Sparkles aria-hidden="true" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-bold" id="reply-drawer-heading">
              Reply to this thread
            </h2>
            <p className="text-xs text-foreground/55">
              AI-generated follow-up, for your review before sending
            </p>
          </div>
        </div>
        <button
          aria-label="Close the reply drawer"
          className="shrink-0 rounded-full border border-black/10 p-2 text-foreground/55 transition-colors hover:bg-black/[0.04]"
          onClick={() => setOpen(false)}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChoiceField
          disabled={busy}
          label="Email length"
          labels={EMAIL_LENGTH_LABELS}
          onChange={setLength}
          options={EMAIL_LENGTHS}
          value={length}
        />
        <ChoiceField
          disabled={busy}
          label="Closing approach"
          labels={CLOSING_APPROACH_LABELS}
          onChange={setClosing}
          options={CLOSING_APPROACHES}
          value={closing}
        />
        <ChoiceField
          disabled={busy}
          label="Email tone"
          labels={EMAIL_TONE_LABELS}
          onChange={setTone}
          options={EMAIL_TONES}
          value={tone}
        />
        <ChoiceField
          disabled={busy}
          label="Email voice"
          labels={EMAIL_VOICE_LABELS}
          onChange={setVoice}
          options={EMAIL_VOICES}
          value={voice}
        />
      </div>

      <div className="mt-4">
        <OriginButton disabled={busy} onClick={generate} size="sm" type="button" variant="outline">
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          {busy ? "Checking and generating…" : draft ? "Regenerate reply" : "Generate reply"}
        </OriginButton>
      </div>

      {warning && (
        <p
          className={`mt-4 text-[13px] font-bold leading-[1.6] ${
            warning.tone === "conflict" ? "text-amber-800" : "text-red-800"
          }`}
          role="alert"
        >
          {warning.text}
        </p>
      )}

      {busy && (
        <AiLoadingState
          messages={STATUS_MESSAGES}
          reducedMotionLabel="Generating the reply — this can take several seconds…"
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

      {draft && !busy && (
        /* key={draft.id}: stage two inserts a new row per generation, so a new
           id is exactly the signal to remount with the new content. */
        <EmailReviewPanel
          className="mt-5"
          description="Saved as a draft. Review and edit it, then approve below to send it from the branch mailbox."
          draft={{ ...draft, recipientOnFile }}
          heading="Review generated reply"
          idPrefix="reply-review"
          key={draft.id}
          onDraftCleared={() => setDraft(null)}
          organisationId={organisationId}
        />
      )}
    </section>
  );
}
