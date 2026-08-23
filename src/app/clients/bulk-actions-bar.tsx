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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { UsersGroupIcon } from "@/components/ui/users-group-icon";

/**
 * Unified bulk action bar: F064 (status) + F065 (comment) + F253 (assign)
 * Keeps PR's sessionStorage-backed selection (useBulkSelection) so filter/page
 * navigation does not discard the selection (F062 AC3) and the narrower status
 * permission can be tracked per id (canStatus).
 *
 * One bar rather than three so the counts stay in sync and the sticky position
 * does not stack.
 */

const PLACEHOLDER = "";

type Pending = "status" | "comment" | "assign";
type TeamMember = { id: string; full_name: string | null };

export function BulkActionsBar({
  team,
  canAssign,
}: {
  team: TeamMember[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const { ids, statusBlockedCount, selected, deselect, clear } = useBulkSelection();
  const [status, setStatus] = useState<PipelineStatus | typeof PLACEHOLDER>(PLACEHOLDER);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Assign state (F253)
  const [assignOwnerId, setAssignOwnerId] = useState("");
  const [assignReason, setAssignReason] = useState("");

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

  const showResult = result !== null && count === 0;

  if (count === 0 && !showResult) return null;

  async function apply(action: Pending) {
    setBusy(true);
    setError(null);
    try {
      let endpoint = "";
      let payload: unknown = null;
      if (action === "status") {
        endpoint = "/api/clients/bulk-status";
        payload = { ids, status };
      } else if (action === "comment") {
        endpoint = "/api/clients/bulk-note";
        payload = { ids, comment: preparedComment.ok ? preparedComment.content : comment };
      } else {
        // assign
        if (!assignOwnerId) {
          setError("Choose a CAM to assign.");
          setBusy(false);
          return;
        }
        if (!assignReason.trim()) {
          setError("A reason is required so the handover can be understood later.");
          setBusy(false);
          return;
        }
        endpoint = "/api/clients/bulk-assign-owner";
        payload = {
          organisationIds: ids,
          ownerId: assignOwnerId,
          reason: assignReason.trim(),
        };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (response.ok) {
        setPending(null);
        if (action === "status") setStatus(PLACEHOLDER);
        else if (action === "comment") setComment("");
        else {
          setAssignOwnerId("");
          setAssignReason("");
        }
        clear();
        setResult(
          body.message ??
            (action === "status"
              ? "The selected clients were updated."
              : action === "comment"
                ? "The comment was added to the selected clients."
                : `Assigned ${count} client${count === 1 ? "" : "s"}.`),
        );
        router.refresh();
        return;
      }
      setError(
        body.error ??
          (action === "status"
            ? "These statuses could not be changed."
            : action === "comment"
              ? "The comment could not be added."
              : "These clients could not be assigned."),
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

  const deselectStatusBlocked = () =>
    deselect([...selected].filter(([, canStatus]) => !canStatus).map(([id]) => id));

  return (
    <>
      <div className="sticky bottom-4 z-30 mt-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5 shadow-lg">
          {count > 0 && (
            <p className="w-full text-[13px] font-bold">
              {count} client{count === 1 ? "" : "s"} selected
              <span className="ml-2 font-normal text-foreground/50">across all filters</span>
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
                onChange={(event) => setStatus(event.target.value as PipelineStatus | typeof PLACEHOLDER)}
              >
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
                disabled={busy || status === PLACEHOLDER || overStatusLimit || statusBlockedCount > 0}
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
                  setResult(null);
                }}
              >
                Clear selection
              </button>

              {canAssign && (
                <button
                  type="button"
                  className="rounded-full bg-[#1c1a18] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setPending("assign");
                  }}
                >
                  Assign owner
                </button>
              )}

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
                {statusBlockedCount} of these {count} {statusBlockedCount === 1 ? "is" : "are"} not yours to
                change status.
              </span>{" "}
              You can still comment{canAssign ? " or assign" : ""} on all {count}. A bulk status change is
              all-or-nothing, so either{" "}
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

          {(overStatusLimit || overNoteLimit) && (
            <p className="w-full text-sm font-bold text-amber-800">
              A single bulk{" "}
              {overStatusLimit && overNoteLimit
                ? "action"
                : overStatusLimit
                  ? "status change"
                  : "comment"}{" "}
              covers at most {Math.min(MAX_BULK_STATUS_CLIENTS, MAX_BULK_NOTE_CLIENTS)} clients.
              Deselect {count - Math.min(MAX_BULK_STATUS_CLIENTS, MAX_BULK_NOTE_CLIENTS)} to continue.
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
                : pending === "comment"
                  ? `Comment on ${count} client${count === 1 ? "" : "s"}?`
                  : `Assign ${count} client${count === 1 ? "" : "s"} to a CAM?`}
            </h2>

            {pending === "status" ? (
              <>
                <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
                  This applies to all {count} selected client{count === 1 ? "" : "s"} in one action,
                  including any that the current filter is not showing. Each change is recorded in the
                  audit log against your account. There is no bulk undo — reversing it means changing
                  each client back.
                </p>
                <p className="mt-2 text-sm leading-[1.7] text-foreground/65">Clients already on {label} are left alone.</p>
              </>
            ) : pending === "comment" ? (
              <>
                <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
                  Each of the {count} selected client{count === 1 ? "" : "s"} gets its own copy of this
                  comment, saved against your name and the current time, including any that the
                  current filter is not showing. There is no bulk undo — removing it means deleting
                  the note on each client.
                </p>
                <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/[0.03] px-3 py-2 text-sm leading-[1.7]">
                  {preparedComment.ok ? preparedComment.content : comment}
                </p>
              </>
            ) : (
              <div className="mt-3 space-y-4">
                <p className="text-sm leading-[1.7] text-foreground/65">
                  Assigning {count} client{count === 1 ? "" : "s"} in one action. Provide a reason for the
                  audit log.
                </p>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">Assign to CAM</span>
                  <Select value={assignOwnerId} onValueChange={setAssignOwnerId}>
                    <SelectTrigger className="w-full rounded-xl bg-white text-sm border-black/15">
                      <SelectValue placeholder="Choose a CAM" />
                    </SelectTrigger>
                    <SelectContent>
                      {team.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.full_name ?? "Unnamed CAM"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">Reason</span>
                  <Input
                    type="text"
                    value={assignReason}
                    onChange={(e) => setAssignReason(e.target.value)}
                    placeholder="e.g. Workload redistribution"
                    className="rounded-xl border-black/15 bg-white"
                  />
                  <span className="text-[11px] text-foreground/40">Recorded in the audit log for each client</span>
                </label>
                <div className="flex items-center gap-2 text-xs text-foreground/60">
                  <UsersGroupIcon className="h-4 w-4" />
                  <span>Reassigns ownership and moves open actions</span>
                </div>
              </div>
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
                    : pending === "comment"
                      ? "Adding…"
                      : "Assigning…"
                  : pending === "status"
                    ? `Yes, update ${count}`
                    : pending === "comment"
                      ? `Yes, comment on ${count}`
                      : `Yes, assign ${count}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
