"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import { BOOKLET_GENERATED_EVENT, type BookletGeneratedDetail } from "@/lib/booklet/browser-event";
import { scheduleReviewedEmail, sendReviewedEmail } from "./outreach-actions";

type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };
type Draft = { id: string; subject: string; body: string };
type EmailLength = "short" | "standard" | "detailed";
type EmailVoice = "180dc" | "consultative" | "plain_language";
type EmailTone = "balanced" | "warm" | "formal" | "concise";
type OpeningApproach = "mission_led" | "direct_intro" | "news_hook";
type ClosingApproach = "soft_cta" | "meeting_request" | "open_question";

/** F100 creates a review draft only, after the current outreach preflight passes. */
export function ComposeButton({
  blocked,
  organisationId,
  outreachStatus,
  suppressionReason,
  ownershipWarning,
}: {
  blocked: boolean;
  organisationId: string;
  outreachStatus: string;
  suppressionReason?: string;
  ownershipWarning?: string;
}) {
  const isStageTwo = outreachStatus === "initial_outreach_sent";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<Warning | null>(
    blocked
      ? {
          text: `This client is suppressed. Outreach is blocked. Reason: ${suppressionReason ?? "No reason was recorded."}`,
          tone: "block",
        }
      : ownershipWarning
        ? { text: ownershipWarning, tone: "conflict" }
        : null,
  );
  const [length, setLength] = useState<EmailLength>("standard");
  const [voice, setVoice] = useState<EmailVoice>("180dc");
  const [tone, setTone] = useState<EmailTone>("balanced");
  const [opening, setOpening] = useState<OpeningApproach>("mission_led");
  const [closing, setClosing] = useState<ClosingApproach>("soft_cta");
  const [booklet, setBooklet] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [approved, setApproved] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");

  useEffect(() => {
    function receiveBooklet(event: Event) {
      const detail = (event as CustomEvent<BookletGeneratedDetail>).detail;
      if (detail.organisationId === organisationId) setBooklet(detail.booklet);
    }
    window.addEventListener(BOOKLET_GENERATED_EVENT, receiveBooklet);
    return () => window.removeEventListener(BOOKLET_GENERATED_EVENT, receiveBooklet);
  }, [organisationId]);

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

      const stagePath = isStageTwo ? "stage-two" : "stage-one";
      const response = await fetch(`/api/clients/${organisationId}/outreach-drafts/${stagePath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ length, voice, tone, opening, closing, booklet }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "The email draft could not be generated. Try again.");
        return;
      }
      const nextDraft = payload as Draft;
      setDraft(nextDraft);
      setSubject(nextDraft.subject);
      setBody(nextDraft.body);
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
      subject,
      body,
      explicitlyApproved: approved,
    });
    setSendMessage(result.message);
    if (result.ok) setDraft(null);
    setSending(false);
  }

  async function schedule() {
    if (!draft || !scheduledAt) return;
    setSending(true);
    const result = await scheduleReviewedEmail({ organisationId, messageId: draft.id, subject, body, explicitlyApproved: approved, scheduledAt: new Date(scheduledAt).toISOString() });
    setSendMessage(result.message);
    if (result.ok) setDraft(null);
    setSending(false);
  }

  if (blocked) {
    return (
      <div>
        <OriginButton variant="outline" size="sm" disabled type="button">
          {isStageTwo ? "Generate Stage 2 follow-up" : "Generate Stage 1 email"}
        </OriginButton>
        <p className="mt-2.5 text-[13px] font-bold leading-[1.6] text-red-800" role="alert">
          {warning?.text}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground/55" aria-live="polite">
        {booklet
          ? "The current generated client booklet will be used as additional context."
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
          <option value="short">Short</option>
          <option value="standard">Standard</option>
          <option value="detailed">Detailed</option>
        </select>
      </label>
      <label className="block max-w-xs text-xs font-bold text-foreground/65">
        Closing approach
        <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" disabled={busy} onChange={(event) => setClosing(event.target.value as ClosingApproach)} value={closing}>
          <option value="soft_cta">Soft invitation</option>
          <option value="meeting_request">Request a short call</option>
          <option value="open_question">Open question</option>
        </select>
      </label>
      {!isStageTwo && (
        <label className="block max-w-xs text-xs font-bold text-foreground/65">
          Opening approach
          <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" disabled={busy} onChange={(event) => setOpening(event.target.value as OpeningApproach)} value={opening}>
            <option value="mission_led">Mission-led</option>
            <option value="direct_intro">Direct introduction</option>
            <option value="news_hook">Relevant news hook</option>
          </select>
        </label>
      )}
      <label className="block max-w-xs text-xs font-bold text-foreground/65">
        Email tone
        <select className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" disabled={busy} onChange={(event) => setTone(event.target.value as EmailTone)} value={tone}>
          <option value="balanced">Balanced</option>
          <option value="warm">Warm</option>
          <option value="formal">Formal</option>
          <option value="concise">Concise</option>
        </select>
      </label>
      <label className="block max-w-xs text-xs font-bold text-foreground/65">
        Email voice
        <select
          className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          disabled={busy}
          onChange={(event) => setVoice(event.target.value as EmailVoice)}
          value={voice}
        >
          <option value="180dc">180DC Sheffield</option>
          <option value="consultative">Consultative</option>
          <option value="plain_language">Plain language</option>
        </select>
      </label>
      <OriginButton variant="outline" size="sm" onClick={generate} disabled={busy} type="button">
        <Sparkles aria-hidden="true" className="h-4 w-4" />
        {busy
          ? "Checking and generating…"
          : draft
            ? `Regenerate ${isStageTwo ? "Stage 2 follow-up" : "Stage 1 email"}`
            : `Generate ${isStageTwo ? "Stage 2 follow-up" : "Stage 1 email"}`}
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
        <section key={draft.id} aria-labelledby="email-review-heading" className="space-y-3 rounded-xl border border-brand/20 bg-brand/[0.04] p-4">
          <div>
            <h3 className="text-sm font-bold" id="email-review-heading">
              Review generated {isStageTwo ? "follow-up " : ""}draft
            </h3>
            <p className="mt-1 text-xs text-foreground/55">
              Saved as a draft. Review and edit it before a separate human send action is made available.
            </p>
          </div>
          <label className="block text-xs font-bold text-foreground/65">
            Subject
            <input className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" onChange={(event) => { setSubject(event.target.value); setApproved(false); }} value={subject} />
          </label>
          <label className="block text-xs font-bold text-foreground/65">
            Body
            <textarea className="mt-1 min-h-64 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm leading-relaxed" onChange={(event) => { setBody(event.target.value); setApproved(false); }} value={body} />
          </label>
          <label className="flex items-start gap-2 text-xs font-bold text-foreground/70">
            <input checked={approved} className="mt-0.5" onChange={(event) => setApproved(event.target.checked)} type="checkbox" />
            I have reviewed the recipient, subject and body and approve this email for sending.
          </label>
          <OriginButton disabled={!approved || sending || !subject.trim() || !body.trim()} onClick={send} type="button">
            {sending ? "Sending…" : "Send reviewed email"}
          </OriginButton>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-foreground/65">
              Or schedule for later
              <input className="mt-1 block rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" min={new Date().toISOString().slice(0, 16)} onChange={(event) => setScheduledAt(event.target.value)} type="datetime-local" value={scheduledAt} />
            </label>
            <OriginButton disabled={!approved || sending || !scheduledAt || !subject.trim() || !body.trim()} onClick={schedule} type="button" variant="outline">
              Schedule reviewed email
            </OriginButton>
          </div>
          <p className="text-xs font-bold text-amber-800" role="status">
            {sendMessage ?? "Not sent — explicit human review and Send action are required."}
          </p>
        </section>
      )}
    </div>
  );
}
