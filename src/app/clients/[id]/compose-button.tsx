"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";

/**
 * F249/F165 visible preflight while F123's provider send path is pending. Every click
 * re-reads suppression and ownership state; a page-open snapshot is not trusted. The
 * future send action must repeat the server check immediately before delivery.
 *
 * Tone is carried alongside the message rather than fixed on the element: a
 * suppression block or a failed check stays red, and only an ownership conflict —
 * which an admin can resolve by reassigning — reads amber. A hard block must never
 * be styled as soft advice.
 */
type Tone = "block" | "conflict";
type Warning = { text: string; tone: Tone };

export function ComposeButton({
  blocked,
  organisationId,
  suppressionReason,
  ownershipWarning,
}: {
  blocked: boolean;
  organisationId: string;
  suppressionReason?: string;
  ownershipWarning?: string;
}) {
  const [clicked, setClicked] = useState(false);
  const [checking, setChecking] = useState(false);
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

  async function checkBeforeCompose() {
    setChecking(true);
    setClicked(false);
    setWarning(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/outreach-preflight`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok || !body.allowed) {
        setWarning({
          text: body.error ?? "Outreach permissions could not be verified. Nothing was sent.",
          tone: body.kind === "ownership_conflict" ? "conflict" : "block",
        });
        return;
      }
      setClicked(true);
    } catch {
      setWarning({
        text: "Outreach permissions could not be checked. Nothing was sent. Please try again.",
        tone: "block",
      });
    } finally {
      setChecking(false);
    }
  }

  if (blocked) {
    return (
      <div>
        <OriginButton
          variant="outline"
          size="sm"
          disabled
          title="Do Not Contact — outreach is blocked for this charity"
          type="button"
        >
          Compose email
        </OriginButton>
        <p className="mt-2.5 text-[13px] font-bold leading-[1.6] text-red-800" role="alert">
          {warning?.text}
        </p>
      </div>
    );
  }

  return (
    <div>
      <OriginButton
        variant="outline"
        size="sm"
        disabled={checking}
        onClick={checkBeforeCompose}
        type="button"
      >
        {checking ? "Checking permissions…" : "Compose email"}
      </OriginButton>
      {warning ? (
        <p
          aria-live="assertive"
          className={
            "mt-2.5 text-[13px] font-bold leading-[1.6] " +
            (warning.tone === "conflict" ? "text-amber-800" : "text-red-800")
          }
          role="alert"
        >
          {warning.text}
        </p>
      ) : null}
      {clicked ? (
        <p aria-live="polite" className="mt-2.5 text-[13px] leading-[1.6] text-foreground/45">
          Outreach checks passed. Email generation isn&apos;t built yet (F094, F100),
          so nothing was sent.
        </p>
      ) : null}
    </div>
  );
}
