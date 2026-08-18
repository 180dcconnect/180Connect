"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OriginButton } from "@/components/ui/origin-button";

export function LiftSuppressionButton({
  organisationId,
  suppressionId,
}: {
  organisationId: string;
  suppressionId?: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setMessage("A reason is required to lift suppression.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/clients/${organisationId}/unsuppress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), suppressionId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The suppression could not be lifted.");
        return;
      }
      setExpanded(false);
      setReason("");
      router.refresh();
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!expanded) {
    return (
      <OriginButton
        variant="outline"
        size="sm"
        onClick={() => setExpanded(true)}
        type="button"
        className="mt-3 bg-white hover:bg-black/5"
      >
        Lift suppression
      </OriginButton>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-black/10 bg-white p-4 shadow-xs">
      <label
        className="block text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70"
        htmlFor="lift-reason"
      >
        Reason for lifting suppression
      </label>
      <p className="mt-1 text-[13px] leading-[1.6] text-foreground/50">
        Required, and kept on file. Restores visibility in the standard client list and unblocks outreach.
      </p>
      <textarea
        className="mt-2.5 w-full rounded-xl border border-input bg-white px-3 py-2 text-sm leading-[1.6] outline-none transition-[box-shadow,border-color] placeholder:text-foreground/35 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
        placeholder="Why this suppression is being lifted (e.g. mistakenly suppressed, client re-engaged)"
        disabled={busy}
        id="lift-reason"
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        value={reason}
      />
      <div className="mt-3 flex flex-wrap gap-2.5">
        <OriginButton
          variant="default"
          size="sm"
          loading={busy}
          disabled={busy || reason.trim() === ""}
          type="submit"
        >
          {busy ? "Lifting…" : "Confirm lift suppression"}
        </OriginButton>
        <OriginButton
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setExpanded(false);
            setReason("");
            setMessage("");
          }}
          type="button"
        >
          Cancel
        </OriginButton>
      </div>
      {message && (
        <p aria-live="polite" role="alert" className="mt-2 text-[13px] font-bold text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
