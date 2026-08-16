"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PIPELINE_STATUSES,
  formatOutreachStatus,
  type PipelineStatus,
} from "@/lib/organisation-format";
import { MAX_BULK_STATUS_CLIENTS } from "@/lib/bulk-status";
import { MAX_BULK_NOTE_CLIENTS, MAX_NOTE_LENGTH, prepareComment } from "@/lib/bulk-note";
import { useBulkSelection } from "./bulk-selection";

/**
 * F064 (#66) Bulk Update Status + F065 (#67) Bulk Add Comment — the bar that
 * appears once clients are selected, and the confirmation in front of each write.
 *
 * Both actions post the whole batch in one request. Not a loop over the
 * single-client routes: N requests would be N transactions, and a failure partway
 * through would leave the list half changed with nothing to tell the CAM which
 * half. The status half calls `set_outreach_status_bulk`; the comment half is a
 * single multi-row INSERT into `notes` (see @/lib/bulk-note for why that one needs
 * no RPC).
 *
 * One bar rather than two: the selection is shared, so two sticky cards would
 * compete for the same corner of the screen and each show its own count of the
 * same thing.
 *
 * F064 AC2 asks for a confirmation step showing how many clients are affected,
 * "given the risk of misuse". The dialog below is that step for both actions, and
 * it is deliberately not dismissible by clicking the confirm button twice by
 * accident: it opens with the cancel button focused, and the count is in the
 * sentence rather than in a corner.
 *
 * WHY THE TWO ACTIONS ARE GATED DIFFERENTLY:
 * Commenting is allowed on any client (F019 makes the record shared, and
 * `notes_insert_author` says so), while a status change needs the client's owner
 * or an admin. So every row is selectable and it is the *status* button that
 * refuses a selection it cannot apply to, naming the number of rows in the way.
 * That count is available here for the whole selection — including rows on other
 * pages and behind other filters — because the selection carries the flag with
 * each id (see ./bulk-selection).
 */

const PLACEHOLDER = "";

type Pending = "status" | "comment";

export function BulkActionsBar() {
  const router = useRouter();
  const { ids, statusBlockedCount, selected, deselect, clear } = useBulkSelection();
  const [status, setStatus] = useState<PipelineStatus | typeof PLACEHOLDER>(PLACEHOLDER);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const count = ids.length;
  const overStatusLimit = count > MAX_BULK_STATUS_CLIENTS;
  const overNoteLimit = count > MAX_BULK_NOTE_CLIENTS;
  const preparedComment = prepareComment(comment);

  useEffect(() => {
    if (pending === null) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPending(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending]);

  // A success message describes a selection that no longer exists, so it is shown
  // only while none exists. Derived rather than cleared in an effect: the moment
  // the CAM starts the next selection, last batch's outcome stops being displayed
  // next to this batch's count, with no render in between where both are true.
  const showResult = result !== null && count === 0;

  if (count === 0 && !showResult) return null;

  async function apply(action: Pending) {
    setBusy(true);
    setError(null);
    const endpoint = action === "status" ? "/api/clients/bulk-status" : "/api/clients/bulk-note";
    const payload =
      action === "status"
        ? { ids, status }
        : // The trimmed value, so what is stored is what the confirmation showed.
          { ids, comment: preparedComment.ok ? preparedComment.content : comment };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (response.ok) {
        setPending(null);
        if (action === "status") setStatus(PLACEHOLDER);
        else setComment("");
        // Cleared only on success: an error leaves the selection intact so the
        // CAM can drop the offending rows and retry rather than rebuild it.
        clear();
        setResult(
          body.message ??
            (action === "status"
              ? "The selected clients were updated."
              : "The comment was added to the selected clients."),
        );
        router.refresh();
        return;
      }
      setError(
        body.error ??
          (action === "status"
            ? "These statuses could not be changed."
            : "The comment could not be added."),
      );
      setPending(null);
    } catch {
      setError("Could not reach the server. Nothing was changed — check your connection.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const label = status === PLACEHOLDER ? "" : formatOutreachStatus(status);

  /** Drops the rows the status action cannot cover, leaving the rest selected. */
  const deselectStatusBlocked = () =>
    deselect([...selected].filter(([, canStatus]) => !canStatus).map(([id]) => id));

  return (
    <>
      <div className="sticky bottom-4 z-30 mt-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5 shadow-lg">
          {count > 0 && (
            <p className="w-full text-[13px] font-bold">
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
                disabled={
                  busy || status === PLACEHOLDER || overStatusLimit || statusBlockedCount > 0
                }
                onClick={() => setPending("status")}
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

              {/* F065. Full width under the status row: a comment is a sentence,
                  not a token, and a single-line input in a toolbar invites a
                  three-word note where the point of the feature is shared context. */}
              <div className="w-full">
                <label className="sr-only" htmlFor="bulk-comment">
                  Comment to add to every selected client
                </label>
                <textarea
                  id="bulk-comment"
                  rows={2}
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  placeholder="Add the same comment to every selected client…"
                  value={comment}
                  maxLength={MAX_NOTE_LENGTH}
                  disabled={busy}
                  onChange={(event) => setComment(event.target.value)}
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    disabled={busy || !preparedComment.ok || overNoteLimit}
                    onClick={() => setPending("comment")}
                  >
                    Comment on {count} client{count === 1 ? "" : "s"}
                  </button>
                  {/* Only once it is worth knowing about. A counter that starts at
                      0/2000 tells a CAM writing two lines that they are being
                      measured, which is not the relationship we want with a
                      free-text field. */}
                  {comment.length > MAX_NOTE_LENGTH - 200 && (
                    <p className="text-xs font-bold text-foreground/50">
                      {comment.length} / {MAX_NOTE_LENGTH}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {statusBlockedCount > 0 && (
            <p className="w-full text-sm text-amber-800">
              <span className="font-bold">
                {statusBlockedCount} of these {count} {statusBlockedCount === 1 ? "is" : "are"} not
                yours to change status.
              </span>{" "}
              You can still comment on all {count}. A bulk status change is all-or-nothing, so
              either{" "}
              <button
                type="button"
                className="underline underline-offset-2 disabled:opacity-50"
                disabled={busy}
                onClick={deselectStatusBlocked}
              >
                deselect {statusBlockedCount === 1 ? "it" : "those"}
              </button>{" "}
              or ask an admin.
            </p>
          )}

          {/* The two ceilings are the same number today, but the sentence names
              whichever one is actually being exceeded rather than assuming they
              stay equal — a message that says "status" while the comment button
              is the disabled one is worse than no message. */}
          {(overStatusLimit || overNoteLimit) && (
            <p className="w-full text-sm font-bold text-amber-800">
              A single bulk{" "}
              {overStatusLimit && overNoteLimit
                ? "action"
                : overStatusLimit
                  ? "status change"
                  : "comment"}{" "}
              covers at most {Math.min(MAX_BULK_STATUS_CLIENTS, MAX_BULK_NOTE_CLIENTS)} clients.
              Deselect {count - Math.min(MAX_BULK_STATUS_CLIENTS, MAX_BULK_NOTE_CLIENTS)} to
              continue.
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

      {pending !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          onClick={() => !busy && setPending(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-confirm-heading"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="bulk-confirm-heading" className="text-lg font-black tracking-[-0.02em]">
              {pending === "status"
                ? `Change ${count} client${count === 1 ? "" : "s"} to ${label}?`
                : `Comment on ${count} client${count === 1 ? "" : "s"}?`}
            </h2>

            {pending === "status" ? (
              <>
                <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
                  This applies to all {count} selected client{count === 1 ? "" : "s"} in one action,
                  including any that the current filter is not showing. Each change is recorded in
                  the audit log against your account. There is no bulk undo — reversing it means
                  changing each client back.
                </p>
                <p className="mt-2 text-sm leading-[1.7] text-foreground/65">
                  Clients already on {label} are left alone.
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
                  Each of the {count} selected client{count === 1 ? "" : "s"} gets its own copy of
                  this comment, saved against your name and the current time, including any that
                  the current filter is not showing. There is no bulk undo — removing it means
                  deleting the note on each client.
                </p>
                {/* The comment itself, shown back before it is written N times.
                    `whitespace-pre-wrap` because the CAM's line breaks are part of
                    what they are about to store. */}
                <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/[0.03] px-3 py-2 text-sm leading-[1.7]">
                  {preparedComment.ok ? preparedComment.content : comment}
                </p>
              </>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={cancelRef}
                type="button"
                className="rounded-full border border-black/10 px-5 py-2 text-[13px] font-bold hover:bg-black/[0.03] disabled:opacity-50"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-brand px-5 py-2 text-[13px] font-bold text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => apply(pending)}
              >
                {busy
                  ? pending === "status"
                    ? "Updating…"
                    : "Adding…"
                  : pending === "status"
                    ? `Yes, update ${count}`
                    : `Yes, comment on ${count}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
