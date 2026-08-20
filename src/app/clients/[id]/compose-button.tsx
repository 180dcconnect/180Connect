"use client";

import { useState } from "react";
import Link from "next/link";
import { History, Sparkles } from "lucide-react";
import { AiLoadingState } from "@/components/ui/ai-loading-state";

type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };
type Draft = { id: string; subject: string; body: string };

const STATUS_MESSAGES = [
  "Checking outreach permissions…",
  "Reading client profile…",
  "Drafting the email…",
  "Polishing the subject line…",
];

/**
 * F100 creates a review draft only, after the current outreach preflight passes.
 * F111 (#108) regenerates it in place — same card, same draft row, new content.
 * Styled to match BookletPanel (booklet-panel.tsx), the app's other one-shot
 * Gemini-backed action: same brand-tinted card, same dashed empty-state box with
 * a prominent CTA, same small header pill once a result exists to regenerate.
 *
 * `historyHref`, when provided, links to this client's slice of
 * /admin/ai-generations (F112 AC3's "accessible without direct database access"
 * — this is the shortcut so nobody has to be walked through "go to the admin
 * dashboard, open AI generation history, then find this client"). Only ever
 * passed by page.tsx when the viewer actually has permission to land there —
 * always shown regardless of local draft state, since this session's `draft` is
 * null on every page load even when past generations exist from an earlier
 * session or a different CAM.
 */
export function ComposeButton({
  blocked,
  organisationId,
  suppressionReason,
  ownershipWarning,
  historyHref,
}: {
  blocked: boolean;
  organisationId: string;
  suppressionReason?: string;
  ownershipWarning?: string;
  historyHref?: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subjectValue, setSubjectValue] = useState("");
  const [bodyValue, setBodyValue] = useState("");
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

  async function generate() {
    // F111 — Regenerate Email Draft (#108), "Important usability": regenerating
    // replaces the visible draft outright (AC2), which would silently throw away
    // any edits the CAM already made to it. Confirm first, but only when there's
    // actually something to lose.
    if (draft && (subjectValue !== draft.subject || bodyValue !== draft.body)) {
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
        body: JSON.stringify({ draftId: draft?.id }),
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
      setSubjectValue(nextDraft.subject);
      setBodyValue(nextDraft.body);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
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

  if (blocked) {
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
        <p className="mt-4 text-[13px] font-bold leading-[1.6] text-red-800" role="alert">
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

      {draft && !busy && (
        <div className="mt-5 space-y-3">
          <p className="text-xs text-foreground/45">
            Saved as a draft. Review and edit it before a separate human send action is made available.
          </p>
          <label className="block text-xs font-bold text-foreground/65">
            Subject
            <input
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
              onChange={(event) => setSubjectValue(event.target.value)}
              value={subjectValue}
            />
          </label>
          <label className="block text-xs font-bold text-foreground/65">
            Body
            <textarea
              className="mt-1 min-h-64 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm leading-relaxed"
              onChange={(event) => setBodyValue(event.target.value)}
              value={bodyValue}
            />
          </label>
          <p className="text-xs font-bold text-amber-800" role="status">
            Not sent — explicit human review and send are required.
          </p>
        </div>
      )}
    </section>
  );
}
