"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      <button
        className="rounded-lg border border-red-200 px-5 py-2.5 font-bold text-red-700 hover:bg-red-50"
        onClick={() => setExpanded(true)}
        type="button"
      >
        Suppress this charity
      </button>
    );
  }

  return (
    <form onSubmit={submit}>
      <label className="block text-sm font-bold" htmlFor="suppress-reason">
        Reason
      </label>
      <p className="mt-1 text-sm text-foreground/65">
        {selfApproves
          ? "Required, and kept on file. Takes effect immediately."
          : "Required, and kept on file. An admin reviews this before it takes effect."}
      </p>
      <textarea
        className="mt-2 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
        disabled={busy}
        id="suppress-reason"
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        value={reason}
      />
      <div className="mt-4 flex gap-3">
        <button
          className="rounded-lg bg-red-700 px-5 py-2.5 font-bold text-white disabled:opacity-50"
          disabled={busy || reason.trim() === ""}
          type="submit"
        >
          {busy
            ? (selfApproves ? "Suppressing…" : "Requesting…")
            : (selfApproves ? "Suppress" : "Request suppression")}
        </button>
        <button
          className="rounded-lg border border-black/15 px-5 py-2.5 font-bold disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setExpanded(false);
            setReason("");
            setMessage("");
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
      <p aria-live="polite" className="mt-4 min-h-6 text-sm font-bold text-red-700">
        {message}
      </p>
    </form>
  );
}
