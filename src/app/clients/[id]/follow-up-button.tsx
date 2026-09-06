"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import { RichTextEmailEditor } from "@/components/rich-text-email-editor";
import { plainTextToEditorHtml } from "@/lib/outreach/email-html";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_TONES, EMAIL_VOICES, type ClosingApproach, type EmailLength, type EmailTone, type EmailVoice } from "@/lib/outreach/stage-one-prompt";

type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };
type Draft = { id: string; subject: string; body: string };

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

/**
 * F101 Stage 2 follow-up trigger. Rendered by the client page only while the
 * client sits at `initial_outreach_sent` — the same condition the route
 * enforces server-side via isStageTwoEligible, so the UI can never offer an
 * action generation would refuse. Like ComposeButton, blocked/ownership states
 * render dead rather than clickable-then-refused; the route re-checks
 * suppression, ownership and eligibility regardless.
 *
 * Each generation saves a new draft row, so the new id remounts the review
 * editor (`key={draft.id}`) and regeneration always shows the latest result.
 */
export function FollowUpButton({
  blocked,
  ownershipBlocked = false,
  organisationId,
  replyEventId,
  suppressionReason,
  ownershipWarning,
}: {
  blocked: boolean;
  ownershipBlocked?: boolean;
  organisationId: string;
  /** F135: identifies the stored reply whose content the server must load. */
  replyEventId?: string;
  suppressionReason?: string;
  ownershipWarning?: string;
}) {
  const isReplyDraft = Boolean(replyEventId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [composerOpen, setComposerOpen] = useState(!replyEventId);
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
  const [closing, setClosing] = useState<ClosingApproach>("soft_cta");

  async function generate() {
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

      const response = await fetch(`/api/clients/${organisationId}/outreach-drafts/stage-two`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ length, voice, tone, closing, replyEventId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "The follow-up draft could not be generated. Try again.");
        return;
      }
      setDraft(payload as Draft);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (blocked || ownershipBlocked) {
    return (
      <div>
        <OriginButton variant="outline" size="sm" disabled type="button">
          {isReplyDraft ? "Draft response" : "Generate follow-up email"}
        </OriginButton>
        <p
          className={`mt-2.5 text-[13px] font-bold leading-[1.6] ${warning?.tone === "conflict" ? "text-amber-800" : "text-red-800"}`}
          role="alert"
        >
          {warning?.text}
        </p>
      </div>
    );
  }

  if (!composerOpen) {
    return (
      <OriginButton variant="outline" size="sm" onClick={() => setComposerOpen(true)} type="button">
        Draft response
      </OriginButton>
    );
  }

  return (
    <div className="space-y-4 border-t border-black/[0.06] pt-4">
      <p className="text-xs font-bold text-foreground/65">
        {isReplyDraft ? "Draft a response to this reply" : "Follow up on the sent email"}
      </p>
      <label className="block max-w-xs text-xs font-bold text-foreground/65">
        Email length
        <select
          className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
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
      </label>
      <label className="block max-w-xs text-xs font-bold text-foreground/65">
        Closing approach
        <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" disabled={busy} onChange={(event) => setClosing(event.target.value as ClosingApproach)} value={closing}>
          {CLOSING_APPROACHES.map((value) => (
            <option key={value} value={value}>
              {CLOSING_APPROACH_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block max-w-xs text-xs font-bold text-foreground/65">
        Email tone
        <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" disabled={busy} onChange={(event) => setTone(event.target.value as EmailTone)} value={tone}>
          {EMAIL_TONES.map((value) => (
            <option key={value} value={value}>
              {EMAIL_TONE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block max-w-xs text-xs font-bold text-foreground/65">
        Email voice
        <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" disabled={busy} onChange={(event) => setVoice(event.target.value as EmailVoice)} value={voice}>
          {EMAIL_VOICES.map((value) => (
            <option key={value} value={value}>
              {EMAIL_VOICE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <OriginButton variant="outline" size="sm" onClick={generate} disabled={busy} type="button">
        <RefreshCw aria-hidden="true" className="h-4 w-4" />
        {busy
          ? "Checking and generating…"
          : draft
            ? isReplyDraft ? "Regenerate response" : "Regenerate follow-up"
            : isReplyDraft ? "Draft response" : "Generate follow-up"}
      </OriginButton>

      {warning && (
        <p
          className={`text-[13px] font-bold leading-[1.6] ${warning.tone === "conflict" ? "text-amber-800" : "text-red-800"}`}
          role="alert"
        >
          {warning.text}
        </p>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-3" role="alert">
          <p className="text-sm font-bold text-red-800">{error}</p>
          <button className="mt-2 text-xs font-bold text-red-800 underline" onClick={generate} type="button">
            Try again
          </button>
        </div>
      )}

      {/* key={draft.id}: every generation inserts a new outreach_messages row, so
          a new id remounts the editor with the latest result instead of leaving
          stale defaultValue text in the fields after a regenerate. */}
      {draft && !busy && (
        <section key={draft.id} aria-labelledby="followup-review-heading" className="space-y-3 rounded-xl border border-brand/20 bg-brand/[0.04] p-4">
          <div>
            <h3 className="text-sm font-bold" id="followup-review-heading">
              {isReplyDraft ? "Review drafted response" : "Review generated follow-up"}
            </h3>
            <p className="mt-1 text-xs text-foreground/55">
              Saved as a draft. Review and edit it before a separate human send action is made available.
            </p>
          </div>
          <label className="block text-xs font-bold text-foreground/65">
            Subject
            <input className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" defaultValue={draft.subject} />
          </label>
          <div>
            <p className="text-xs font-bold text-foreground/65" id="followup-body-heading">
              Body
            </p>
            <div className="mt-1">
              <RichTextEmailEditor
                ariaLabelledBy="followup-body-heading"
                initialContent={plainTextToEditorHtml(draft.body)}
              />
            </div>
          </div>
          <p className="text-xs font-bold text-amber-800" role="status">
            Not sent — explicit human review and send are required.
          </p>
        </section>
      )}
    </div>
  );
}
