"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OriginButton } from "@/components/ui/origin-button";

export function SuppressButton({
  organisationId,
  selfApproves,
}: {
  organisationId: string;
  /** True for an admin caller — request_suppression self-approves, no pending step. */
  selfApproves: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/clients/${organisationId}/suppress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The charity could not be suppressed.");
        return;
      }
      // The server component re-reads suppression state and swaps this button for
      // the pending/active banner.
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
        variant="destructive"
        size="sm"
        onClick={() => setExpanded(true)}
        type="button"
      >
        Flag as Do Not Contact
      </OriginButton>
    );
  }

  return (
    <form onSubmit={submit}>
      <label
        className="block text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40"
        htmlFor="suppress-reason"
      >
        Reason
      </label>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-foreground/50">
        e.g. hard no, legal request, unsubscribe.{" "}
        {selfApproves
          ? "Required, and kept on file. Takes effect immediately."
          : "Required, and kept on file. An admin reviews this before it takes effect."}
      </p>
      <textarea
        className="mt-2.5 w-full rounded-xl border border-input bg-white px-3 py-2 text-sm leading-[1.6] outline-none transition-[box-shadow,border-color] placeholder:text-foreground/35 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
        placeholder="Why this client must not be contacted"
        disabled={busy}
        id="suppress-reason"
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        value={reason}
      />
      <div className="mt-4 flex flex-wrap gap-2.5">
        <OriginButton
          variant="destructive"
          size="sm"
          loading={busy}
          disabled={busy || reason.trim() === ""}
          type="submit"
        >
          {busy
            ? (selfApproves ? "Flagging…" : "Requesting…")
            : (selfApproves ? "Flag as Do Not Contact" : "Request Do Not Contact")}
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
        <p aria-live="polite" role="alert" className="mt-3 text-[13px] font-bold text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
