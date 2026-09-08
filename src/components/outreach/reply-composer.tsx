"use client";

import { useState } from "react";

import { LoaderPinwheel } from "@/components/animate-ui/icons/loader-pinwheel";

import { AiLoadingState } from "@/components/ui/ai-loading-state";
import { EmailReviewPanel } from "@/components/outreach/email-review-panel";
import { AiSettingsPicker, type AiSettingEntry } from "@/components/outreach/ai-settings-picker";
import {
  CLOSING_APPROACHES,
  EMAIL_LENGTHS,
  EMAIL_REGISTER_LABELS,
  EMAIL_REGISTERS,
  type ClosingApproach,
  type EmailLength,
  type EmailRegister,
} from "@/lib/outreach/stage-one-prompt";

/**
 * Reply to a thread without leaving it — the inbox reading pane's composer.
 *
 * Was ReplyDrawer (src/components/inbox/reply-drawer.tsx) on the old
 * /inbox/[orgId] page. The drawer chrome is gone because the reading pane now
 * owns opening and closing; what survives is the part that matters — the same
 * two halves the client page uses, the stage-two endpoint and EmailReviewPanel,
 * so nothing about the send path is new here. That panel calls the approved
 * server actions (PRD §12.1, Gmail API on the CAM's own authorised account),
 * which re-check suppression, ownership, rate limits and human review
 * server-side regardless of which page called them.
 *
 * This replaced a reply box in the reading pane that only ever mutated local
 * state: it looked like a send, wrote nothing, and skipped every one of those
 * checks. A reply surface that cannot actually send is worse than none.
 *
 * Eligibility is NOT widened for the inbox. `/api/clients/[id]/outreach-drafts/
 * stage-two` enforces `isStageTwoEligible` (outreach_status ===
 * "initial_outreach_sent"), so a composer offered outside that window would be
 * a button whose only possible outcome is a 409 — the caller decides whether to
 * render it, the same rule the client page's FollowUpButton follows.
 *
 * No existing-draft hydration, deliberately. Each generation inserts a NEW
 * outreach_messages row, and an abandoned draft row cannot be told apart from a
 * live one by status alone. Reopening saved drafts stays a client-page job;
 * this composer only ever edits the draft it just generated.
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

const CLOSING_APPROACH_LABELS: Record<ClosingApproach, string> = {
  soft_cta: "Soft invitation",
  meeting_request: "Request a short call",
  open_question: "Open question",
};

type Draft = { id: string; subject: string; body: string };
type Warning = { text: string; tone: "block" | "conflict" };

export function ReplyComposer({
  organisationId,
  recipientOnFile,
  blocked = false,
  blockedReason,
  className = "",
}: {
  organisationId: string;
  /** The client's email as held on the record — the mismatch-warning baseline. */
  recipientOnFile: string | null;
  /** Suppressed, owned by another CAM, or a mock thread with no draft row to write. */
  blocked?: boolean;
  blockedReason?: string;
  className?: string;
}) {
  // Every generation inserts a new draft row, so this id is enough to remount
  // the review panel with the new content — unlike the Stage 1 card, which
  // regenerates in place and needs a separate counter for that.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Spins the generate icon for as long as the button is hovered — the icon
  // alone is a smaller hover target than the button around it.
  const [aiHover, setAiHover] = useState(false);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [length, setLength] = useState<EmailLength>("standard");
  const [register, setRegister] = useState<EmailRegister>("professional");
  const [closing, setClosing] = useState<ClosingApproach>("soft_cta");

  // Three dials rather than the Stage 1 card's four: a reply has no opening
  // approach to choose, the message it answers is the opening.
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
      label: "Email register",
      hint: "How formal and how warm the reply reads. Every reply is written as \u201cwe\u201d either way.",
      options: EMAIL_REGISTERS.map((value) => ({ value, label: EMAIL_REGISTER_LABELS[value] })),
      selected: register,
      onSelect: (value) => setRegister(value as EmailRegister),
    },
    {
      key: "closing",
      label: "Closing approach",
      options: CLOSING_APPROACHES.map((value) => ({ value, label: CLOSING_APPROACH_LABELS[value] })),
      selected: closing,
      onSelect: (value) => setClosing(value as ClosingApproach),
    },
  ];

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
        body: JSON.stringify({ length, register, closing }),
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
      <p
        className={`text-[13px] leading-[1.6] font-semibold text-stop ${className}`}
        role="alert"
      >
        {blockedReason ?? "Outreach is unavailable on this client."}
      </p>
    );
  }

  return (
    <section aria-labelledby="reply-composer-heading" className={className}>
      <h3
        className="text-[13px] font-semibold tracking-[-0.01em] text-ink"
        id="reply-composer-heading"
      >
        Reply to this thread
      </h3>
      <p className="mt-1 text-[12px] leading-[1.55] text-dim">
        Generated for your review. Nothing sends until you approve it.
      </p>

      {!draft && !busy && <AiSettingsPicker disabled={busy} settings={aiSettings} />}

      {!busy && (
        <button
          className="mt-3 flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          onClick={generate}
          onMouseEnter={() => setAiHover(true)}
          onMouseLeave={() => setAiHover(false)}
          type="button"
        >
          <LoaderPinwheel animate={aiHover} size={16} aria-hidden="true" />
          {draft ? "Regenerate reply" : "Generate reply"}
        </button>
      )}

      {warning && (
        <p
          className={`mt-4 text-[13px] leading-[1.6] font-semibold ${
            warning.tone === "conflict" ? "text-hold" : "text-stop"
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
