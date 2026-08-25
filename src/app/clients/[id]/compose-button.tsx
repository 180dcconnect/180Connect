"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import { CLOSING_APPROACHES, EMAIL_LENGTHS, EMAIL_TONES, EMAIL_VOICES, OPENING_APPROACHES, SIZE_TEMPLATES, SIZE_TONE_LABELS, type ClosingApproach, type EmailLength, type EmailTone, type EmailVoice, type OpeningApproach, type SizeTemplate } from "@/lib/outreach/stage-one-prompt";

type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };
type Draft = { id: string; subject: string; body: string; sizeTemplate?: string };

function sizeTemplateLabel(sizeTemplate: string | undefined): string {
  return sizeTemplate && SIZE_TEMPLATES.includes(sizeTemplate as SizeTemplate)
    ? SIZE_TONE_LABELS[sizeTemplate as SizeTemplate]
    : SIZE_TONE_LABELS.default;
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
 * saved booklet, so the hint can never promise more than generation will use. */
export function ComposeButton({
  blocked,
  ownershipBlocked = false,
  organisationId,
  suppressionReason,
  ownershipWarning,
  hasSavedBooklet = false,
}: {
  blocked: boolean;
  ownershipBlocked?: boolean;
  organisationId: string;
  suppressionReason?: string;
  ownershipWarning?: string;
  hasSavedBooklet?: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
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
        body: JSON.stringify({ length, voice, tone, opening, closing }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "The email draft could not be generated. Try again.");
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
          Generate Stage 1 email
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

  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground/55" aria-live="polite">
        {hasSavedBooklet
          ? "The client's saved booklet is included as additional context."
          : "Generate the client booklet first to include its insights in this email."}
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
        <span className="mt-1 block font-normal text-foreground/55">How long the email body should be.</span>
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
        Opening approach
        <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" disabled={busy} onChange={(event) => setOpening(event.target.value as OpeningApproach)} value={opening}>
          {OPENING_APPROACHES.map((value) => (
            <option key={value} value={value}>
              {OPENING_APPROACH_LABELS[value]}
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
        <span className="mt-1 block font-normal text-foreground/55">
          How friendly or formal the email reads — separate from its length and voice.
        </span>
      </label>
      <label className="block max-w-xs text-xs font-bold text-foreground/65">
        Email voice
        <select
          className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
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
      <OriginButton variant="outline" size="sm" onClick={generate} disabled={busy} type="button">
        <Sparkles aria-hidden="true" className="h-4 w-4" />
        {busy ? "Checking and generating…" : draft ? "Regenerate Stage 1 email" : "Generate Stage 1 email"}
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

      {draft && !busy && (
        <section aria-labelledby="email-review-heading" className="space-y-3 rounded-xl border border-brand/20 bg-brand/[0.04] p-4">
          <div>
            <h3 className="text-sm font-bold" id="email-review-heading">Review generated draft</h3>
            <p className="mt-1 text-xs text-foreground/55">
              Saved as a draft. Review and edit it before a separate human send action is made available.
            </p>
            <p className="mt-1 text-xs text-foreground/65">
              Size tone template: {sizeTemplateLabel(draft.sizeTemplate)}
            </p>
          </div>
          <label className="block text-xs font-bold text-foreground/65">
            Subject
            <input className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" defaultValue={draft.subject} />
          </label>
          <label className="block text-xs font-bold text-foreground/65">
            Body
            <textarea className="mt-1 min-h-64 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm leading-relaxed" defaultValue={draft.body} />
          </label>
          <p className="text-xs font-bold text-amber-800" role="status">
            Not sent — explicit human review and send are required.
          </p>
        </section>
      )}
    </div>
  );
}
