"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";

type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };
type Draft = { id: string; subject: string; body: string };

/**
 * F019 (#22): a client owned by another CAM is visible in full, but its
 * outreach actions are not available — the button is dead on arrival rather
 * than clickable-then-refused. `blocked` stays the harder state (suppression);
 * `ownershipBlocked` renders the same disabled shape in the softer conflict
 * tone. The server-side preflight behind `generate()` still re-checks both,
 * so this is presentation over an enforcement that does not depend on it.
 */
export function ComposeButton({
  blocked,
  ownershipBlocked = false,
  organisationId,
  suppressionReason,
  ownershipWarning,
}: {
  blocked: boolean;
  ownershipBlocked?: boolean;
  organisationId: string;
  suppressionReason?: string;
  ownershipWarning?: string;
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
              Saved as a draft. Review it here — edits made in this preview are not saved yet, and a separate human send action arrives later.
            </p>
          </div>
          <label className="block text-xs font-bold text-foreground/65">
            Subject
            <input key={`subject-${draft.id}`} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" defaultValue={draft.subject} />
          </label>
          <label className="block text-xs font-bold text-foreground/65">
            Body
            <textarea key={`body-${draft.id}`} className="mt-1 min-h-64 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm leading-relaxed" defaultValue={draft.body} />
          </label>
          <p className="text-xs font-bold text-amber-800" role="status">
            Not sent — explicit human review and send are required.
          </p>
        </section>
      )}
    </div>
  );
}
