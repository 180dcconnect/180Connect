"use client";

import { useState } from "react";

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
        <button
          className="cursor-not-allowed rounded-lg border border-black/10 px-5 py-2.5 font-bold text-foreground/40"
          disabled
          title="Do Not Contact — outreach is blocked for this charity"
          type="button"
        >
          Compose email
        </button>
        <p className="mt-2 text-sm font-bold text-red-800" role="alert">{warning}</p>
      </div>
    );
  }

  return (
    <div>
      <button
        className="rounded-lg border border-black/15 px-5 py-2.5 font-bold hover:bg-black/[0.03] disabled:cursor-wait disabled:opacity-60"
        disabled={checking}
        onClick={checkBeforeCompose}
        type="button"
      >
        {checking ? "Checking suppression…" : "Compose email"}
      </button>
      {warning ? (
        <p aria-live="assertive" className="mt-2 text-sm font-bold text-red-800" role="alert">
          {warning}
        </p>
      ) : null}
      {clicked ? (
        <p aria-live="polite" className="mt-2 text-xs text-foreground/50">
          Suppression check passed. Email generation is not built yet (F094, F100),
          so nothing was sent.
        </p>
      ) : null}
    </div>
  );
}
