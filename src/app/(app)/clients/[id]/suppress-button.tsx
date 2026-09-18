"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteButton } from "@/components/ui/delete-button";

export function SuppressButton({
  organisationId,
  selfApproves,
  defaultExpanded = false,
}: {
  organisationId: string;
  /** True for an admin caller — request_suppression self-approves, no pending step. */
  selfApproves: boolean;
  /**
   * Skip the collapsed trigger and open straight into the reason form. Set by
   * the record header's overflow menu, where the menu item *is* the trigger and
   * a second "Flag as Do Not Contact" button inside the dialog would be a step
   * that asks the same question twice.
   */
  defaultExpanded?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (!reason.trim()) {
      setMessage("A reason is required before flagging as Do Not Contact.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/clients/${organisationId}/suppress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
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
      <DeleteButton
        label="Flag"
        confirmLabel="Confirm"
        variant="solid"
        size="sm"
        snapOnConfirm={false}
        vanishOnComplete={false}
        onConfirm={() => setExpanded(true)}
      />
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleConfirm(); }}>
      <label
        className="block text-[13px] font-medium text-dim"
        htmlFor="suppress-reason"
      >
        Reason
      </label>
      <textarea
        className="mt-2 w-full rounded-inset border border-input bg-white px-3 py-2 text-sm leading-[1.6] outline-none transition-[box-shadow,border-color] placeholder:text-faint focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
        placeholder={
          selfApproves
            ? "e.g. hard no, legal request, unsubscribe. Required, and kept on file. Takes effect immediately."
            : "e.g. hard no, legal request, unsubscribe. Required, and kept on file. An admin reviews this before it takes effect."
        }
        disabled={busy}
        id="suppress-reason"
        onChange={(event) => {
          setReason(event.target.value);
          if (message) setMessage("");
        }}
        rows={3}
        value={reason}
      />
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <DeleteButton
          disabled={busy || reason.trim() === ""}
          label="Flag"
          confirmLabel="Confirm"
          deletingLabel={selfApproves ? "Flagging…" : "Requesting…"}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!defaultExpanded) setExpanded(false);
            setMessage("");
          }}
          size="sm"
          variant="solid"
          snapOnConfirm={true}
          vanishOnComplete={true}
        />
        {!defaultExpanded && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setExpanded(false);
              setMessage("");
            }}
            className="text-xs font-semibold text-dim hover:text-ink px-3 py-1.5"
          >
            Cancel
          </button>
        )}
      </div>
      {message && (
        <p aria-live="polite" role="alert" className="mt-3 text-[13px] font-semibold text-stop">
          {message}
        </p>
      )}
    </form>
  );
}
