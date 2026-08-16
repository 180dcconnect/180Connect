"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PIPELINE_STATUSES,
  formatOutreachStatus,
  type PipelineStatus,
} from "@/lib/organisation-format";
import { MAX_BULK_STATUS_CLIENTS } from "@/lib/bulk-status";
import { useBulkSelection } from "./bulk-selection";

/**
 * F064 (#66) — the bar that appears once clients are selected, and the
 * confirmation in front of the write.
 *
 * The whole batch goes to /api/clients/bulk-status in one request, which calls
 * set_outreach_status_bulk once. Not a loop over the single-client route: N
 * requests would be N transactions, and a failure partway through would leave the
 * list half changed with nothing to tell the CAM which half.
 *
 * AC2 asks for a confirmation step showing how many clients are affected, "given
 * the risk of misuse". The dialog below is that step, and it is deliberately not
 * dismissible by clicking the confirm button twice by accident: it opens with the
 * cancel button focused, and the count is in the sentence rather than in a corner.
 */

const PLACEHOLDER = "";

export function BulkStatusBar() {
  const router = useRouter();
  const { selected, clear } = useBulkSelection();
  const [status, setStatus] = useState<PipelineStatus | typeof PLACEHOLDER>(PLACEHOLDER);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const count = selected.size;
  const overLimit = count > MAX_BULK_STATUS_CLIENTS;

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  // A success message describes a selection that no longer exists, so it is shown
  // only while none exists. Derived rather than cleared in an effect: the moment
  // the CAM starts the next selection, last batch's outcome stops being displayed
  // next to this batch's count, with no render in between where both are true.
  const showResult = result !== null && count === 0;

  if (count === 0 && !showResult) return null;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/clients/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], status }),
      });
      const body = await response.json();
      if (response.ok) {
        setConfirming(false);
        setStatus(PLACEHOLDER);
        // Cleared only on success: an error leaves the selection intact so the
        // CAM can drop the offending rows and retry rather than rebuild it.
        clear();
        setResult(body.message ?? "The selected clients were updated.");
        router.refresh();
        return;
      }
      setError(body.error ?? "These statuses could not be changed.");
      setConfirming(false);
    } catch {
      setError("Could not reach the server. Nothing was changed — check your connection.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const label = status === PLACEHOLDER ? "" : formatOutreachStatus(status);

  return (
    <>
      <div className="sticky bottom-4 z-30 mt-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5 shadow-lg">
          {count > 0 && (
            <p className="text-[13px] font-bold">
              {count} client{count === 1 ? "" : "s"} selected
              <span className="ml-2 font-normal text-foreground/50">
                {/* The selection outlives the filter, so it can hold rows this
                    page is not showing. Saying so is the difference between a
                    count a CAM trusts and one that looks like a bug. */}
                across all filters
              </span>
            </p>
          )}

          {count > 0 && (
            <>
              <label className="sr-only" htmlFor="bulk-status">
                Pipeline status to apply
              </label>
              <select
                id="bulk-status"
                className="rounded-lg border border-black/10 px-3 py-2 text-sm"
                value={status}
                disabled={busy}
                onChange={(event) =>
                  setStatus(event.target.value as PipelineStatus | typeof PLACEHOLDER)
                }
              >
                {/* No default selection: the CAM picks the status deliberately
                    rather than the first of ten being pre-armed under a button
                    that changes every selected client. */}
                <option value={PLACEHOLDER}>Change status to…</option>
                {PIPELINE_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {formatOutreachStatus(option)}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                disabled={busy || status === PLACEHOLDER || overLimit}
                onClick={() => setConfirming(true)}
              >
                Update {count} client{count === 1 ? "" : "s"}
              </button>

              <button
                type="button"
                className="rounded-full border border-black/10 px-4 py-2 text-xs font-bold text-foreground/60 hover:bg-black/[0.03] disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  clear();
                  setError(null);
                  // Not "the last batch worked" left hanging over a selection the
                  // CAM has just abandoned.
                  setResult(null);
                }}
              >
                Clear selection
              </button>
            </>
          )}

          {overLimit && (
            <p className="w-full text-sm font-bold text-amber-800">
              A single bulk change covers at most {MAX_BULK_STATUS_CLIENTS} clients. Deselect{" "}
              {count - MAX_BULK_STATUS_CLIENTS} to continue.
            </p>
          )}

          {error && (
            <p aria-live="polite" role="alert" className="w-full text-sm font-bold text-red-800">
              {error}
            </p>
          )}

          {showResult && (
            <p aria-live="polite" className="w-full text-sm font-bold text-foreground/70">
              {result}
            </p>
          )}
        </div>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-confirm-heading"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="bulk-confirm-heading" className="text-lg font-black tracking-[-0.02em]">
              Change {count} client{count === 1 ? "" : "s"} to {label}?
            </h2>
            <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
              This applies to all {count} selected client{count === 1 ? "" : "s"} in one action,
              including any that the current filter is not showing. Each change is recorded in the
              audit log against your account. There is no bulk undo — reversing it means changing
              each client back.
            </p>
            <p className="mt-2 text-sm leading-[1.7] text-foreground/65">
              Clients already on {label} are left alone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={cancelRef}
                type="button"
                className="rounded-full border border-black/10 px-5 py-2 text-[13px] font-bold hover:bg-black/[0.03] disabled:opacity-50"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-brand px-5 py-2 text-[13px] font-bold text-white disabled:opacity-50"
                disabled={busy}
                onClick={apply}
              >
                {busy ? "Updating…" : `Yes, update ${count}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
