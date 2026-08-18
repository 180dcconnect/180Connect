"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";

/**
 * F249's visible preflight while F123's provider send path is pending. Every click
 * re-reads suppression state; a page-open snapshot is not trusted. The future send
 * action must repeat the server check immediately before delivery.
 */
export function ComposeButton({
  blocked,
  organisationId,
  suppressionReason,
}: {
  blocked: boolean;
  organisationId: string;
  suppressionReason?: string;
}) {
  const [clicked, setClicked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState<string | null>(
    blocked
      ? `This client is suppressed. Outreach is blocked. Reason: ${suppressionReason ?? "No reason was recorded."}`
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
        setWarning(body.error ?? "Suppression status could not be checked. Nothing was sent.");
        return;
      }
      setClicked(true);
    } catch {
      setWarning("Suppression status could not be checked. Nothing was sent. Please try again.");
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
          {warning}
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
        {checking ? "Checking suppression…" : "Compose email"}
      </OriginButton>
      {warning ? (
        <p aria-live="assertive" className="mt-2.5 text-[13px] font-bold leading-[1.6] text-red-800" role="alert">
          {warning}
        </p>
      ) : null}
      {clicked ? (
        <p aria-live="polite" className="mt-2.5 text-[13px] leading-[1.6] text-foreground/45">
          Suppression check passed. Email generation isn&apos;t built yet (F094, F100),
          so nothing was sent.
        </p>
      ) : null}
    </div>
  );
}
