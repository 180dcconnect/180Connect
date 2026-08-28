"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  PIPELINE_STATUSES,
  formatOutreachStatus,
  type PipelineStatus,
} from "@/lib/organisation-format";
import { MAX_BULK_STATUS_CLIENTS } from "@/lib/bulk-status";
import { MAX_BULK_NOTE_CLIENTS, MAX_NOTE_LENGTH, prepareComment } from "@/lib/bulk-note";
import { MAX_BULK_TAG_CLIENTS } from "@/lib/bulk-tags";
import { useBulkSelection } from "./bulk-selection";
import { OriginButton } from "@/components/ui/origin-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UsersGroupIcon } from "@/components/ui/users-group-icon";

/**
 * Unified bulk action bar: F064 (status) + F065 (comment) + F253 (assign)
 * + F063 (tags), rebuilt as a compact dark floating pill.
 *
 * SELECTING IS POINTING, NOT COMMITTING — F062's bar is a readout of what the
 * CAM is holding plus the things they might do to all of it. The earlier
 * incarnation dumped every control, a comment box and the warning copy onto
 * the page the moment a single row was picked, so one selection turned the
 * bottom of the list into a forms screen. This one keeps that promise instead:
 *
 *   - A fixed, floating pill (not a sticky in-flow card) so selecting never
 *     reflows the list under it. Slides in when anything is selected.
 *   - The count readout (badge + count + "across all filters" scope note) is
 *     the anchor, always visible.
 *   - Actions appear as compact pills; the heavyweight inputs — a status
 *     picker, a tag multi-picker, a comment composer — are revealed on demand
 *     inside a popover or an expandable composer rather than parked on screen.
 *   - The all-or-nothing consequence of a bulk change, and any permission or
 *     limit caveats, live in the action's own confirm/dialog, not on the bar.
 */

// Motion-ready easing from the design system / OriginButton.
const EASE = [0.16, 1, 0.3, 1] as const;

const PLACEHOLDER = "";

type Pending = "status" | "comment" | "assign";
type TeamMember = { id: string; full_name: string | null };
type TagOption = { id: string; name: string };

export function BulkActionsBar({
  team,
  canAssign,
  tags,
  canTag,
}: {
  team: TeamMember[];
  canAssign: boolean;
  tags: TagOption[];
  canTag: boolean;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { ids, statusBlockedCount, selected, deselect, clear } = useBulkSelection();
  const [status, setStatus] = useState<PipelineStatus | typeof PLACEHOLDER>(PLACEHOLDER);
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Assign state (F253)
  const [assignOwnerId, setAssignOwnerId] = useState("");
  const [assignReason, setAssignReason] = useState("");

  // Tags state (F063)
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  const count = ids.length;
  const overStatusLimit = count > MAX_BULK_STATUS_CLIENTS;
  const overNoteLimit = count > MAX_BULK_NOTE_CLIENTS;
  const overTagLimit = count > MAX_BULK_TAG_CLIENTS;
  const preparedComment = prepareComment(comment);
  const statusBlocked = statusBlockedCount > 0;

  // Escape clears the whole selection while the bar is up (and closes any open
  // composer/popover first). Actually closing the confirm dialog takes priority:
  // when pending, Escape dismisses it and does nothing more.
  useEffect(() => {
    if (count === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pending !== null) {
        setPending(null);
        return;
      }
      if (commentOpen) {
        setCommentOpen(false);
        return;
      }
      clear();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [count, pending, commentOpen, clear]);

  // Focus the composer when it expands.
  useEffect(() => {
    if (commentOpen) composerRef.current?.focus();
  }, [commentOpen]);

  useEffect(() => {
    if (pending === null) return;
    cancelRef.current?.focus();
  }, [pending]);

  const deselectStatusBlocked = useCallback(
    () =>
      deselect([...selected].filter(([, canStatus]) => !canStatus).map(([id]) => id)),
    [selected, deselect],
  );

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
        else if (action === "comment") {
          setComment("");
          setCommentOpen(false);
        } else {
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

  // F063 AC1: one or more existing tags applied to every selected client in a
  // single action. Applies immediately — additive and reversible via F192 — and
  // reports through the same result/error lines as the rest of the bar.
  async function applyTags() {
    if (selectedTagIds.size === 0) {
      setError("Choose at least one tag to apply.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/clients/bulk-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, tagIds: [...selectedTagIds] }),
      });
      const body = await response.json();
      if (response.ok) {
        setSelectedTagIds(new Set());
        clear();
        setResult(body.message ?? "The tags were applied to the selected clients.");
        router.refresh();
        return;
      }
      setError(body.error ?? "The tags could not be applied.");
    } catch {
      setError("Could not reach the server. Nothing was changed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const toggleTag = (tagId: string) =>
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });

  const resetTransients = () => {
    setError(null);
    setResult(null);
    setStatus(PLACEHOLDER);
    setComment("");
    setCommentOpen(false);
    setSelectedTagIds(new Set());
  };

  const pillMotion = reducedMotion
    ? { initial: false, animate: { opacity: 1 } }
    : {
        initial: { y: 36, opacity: 0 },
        animate: { y: 0, opacity: 1 },
        exit: { y: 36, opacity: 0 },
        transition: { duration: 0.22, ease: EASE },
      };

  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            {...pillMotion}
            className="fixed bottom-6 inset-x-0 z-40 mx-auto w-[min(44rem,calc(100vw-2rem))]"
            role="region"
            aria-label="Bulk actions"
          >
            <div className="overflow-hidden rounded-2xl bg-[#1c1a18]/95 shadow-2xl ring-1 ring-white/25 backdrop-blur-md">
              {/* Expandable light composer, sits above the dark pill when open. */}
              <AnimatePresence initial={false}>
                {commentOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 border-b border-white/10 bg-white px-4 py-3">
                      <Textarea
                        ref={composerRef}
                        id="bulk-comment"
                        rows={2}
                        className="rounded-xl border-black/15 bg-white text-sm"
                        placeholder="Add the same comment to every selected client…"
                        value={comment}
                        maxLength={MAX_NOTE_LENGTH}
                        disabled={busy}
                        onChange={(event) => setComment(event.target.value)}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <OriginButton
                          type="button"
                          variant="dark"
                          size="sm"
                          disabled={busy || !preparedComment.ok || overNoteLimit}
                          onClick={() => setPending("comment")}
                        >
                          Comment on {count} client{count === 1 ? "" : "s"}
                        </OriginButton>
                        <span className="text-[11px] text-foreground/50">
                          {comment.length} / {MAX_NOTE_LENGTH}
                        </span>
                        {overNoteLimit && (
                          <span className="text-[11px] font-bold text-amber-700">
                            One bulk action covers at most {MAX_BULK_NOTE_CLIENTS} — deselect some.
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-[#e6f5c0]">
                    {count}
                  </span>
                  <div className="min-w-0 leading-tight">
                    <p className="text-sm font-bold text-white/90">
                      {count} client{count === 1 ? "" : "s"} selected
                    </p>
                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">
                      across all filters
                    </p>
                  </div>
                </div>

                {statusBlocked && (
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                    {statusBlockedCount} restricted
                  </span>
                )}

                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {/* Status picker */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <OriginButton
                        size="xs"
                        variant="ghost"
                        className="text-white/70 hover:text-white"
                        disabled={busy}
                        title={
                          overStatusLimit
                            ? `A bulk status change covers at most ${MAX_BULK_STATUS_CLIENTS} clients`
                            : undefined
                        }
                      >
                        Status{status !== PLACEHOLDER ? ` · ${label}` : ""}
                      </OriginButton>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-2" sideOffset={8}>
                      <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                        Change status to
                      </p>
                      <div className="mt-1 space-y-0.5">
                        {PIPELINE_STATUSES.map((option) => (
                          <button
                            key={option}
                            type="button"
                            disabled={busy || overStatusLimit}
                            onClick={() => setStatus(option)}
                            aria-pressed={status === option}
                            className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-40 ${
                              status === option
                                ? "bg-brand/10 font-bold text-brand"
                                : "hover:bg-black/[0.04]"
                            }`}
                          >
                            {formatOutreachStatus(option)}
                          </button>
                        ))}
                      </div>
                      {(statusBlocked || overStatusLimit) && (
                        <div className="mt-2 border-t border-black/[0.06] pt-2 text-[11px] leading-[1.6] text-amber-700">
                          {statusBlocked ? (
                            <>
                              <span className="font-bold">
                                {statusBlockedCount} of {count} are not yours to change.
                              </span>{" "}
                              The change is all-or-nothing —{" "}
                              <button
                                type="button"
                                className="font-bold underline underline-offset-2"
                                disabled={busy}
                                onClick={deselectStatusBlocked}
                              >
                                deselect {statusBlockedCount === 1 ? "it" : "those"}
                              </button>{" "}
                              or ask an admin.
                            </>
                          ) : (
                            `Covers at most ${MAX_BULK_STATUS_CLIENTS} clients. Deselect some to continue.`
                          )}
                        </div>
                      )}
                      {status !== PLACEHOLDER && (
                        <OriginButton
                          type="button"
                          size="sm"
                          variant="default"
                          className="mt-2 w-full"
                          disabled={busy}
                          onClick={() => setPending("status")}
                        >
                          Update {count} client{count === 1 ? "" : "s"}
                        </OriginButton>
                      )}
                    </PopoverContent>
                  </Popover>

                  {/* Comment composer toggle */}
                  <OriginButton
                    size="xs"
                    variant="ghost"
                    className="text-white/70 hover:text-white"
                    disabled={busy}
                    aria-expanded={commentOpen}
                    onClick={() => {
                      setError(null);
                      setCommentOpen((open) => !open);
                    }}
                  >
                    Comment
                  </OriginButton>

                  {/* Tags picker — applies immediately, no confirm step (F063). */}
                  {canTag && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <OriginButton
                          size="xs"
                          variant="ghost"
                          className="text-white/70 hover:text-white"
                          disabled={busy || overTagLimit || tags.length === 0}
                          title={
                            tags.length === 0
                              ? "No tags exist yet — create them under Admin → Tags first."
                              : undefined
                          }
                        >
                          Tags{selectedTagIds.size > 0 ? ` (${selectedTagIds.size})` : ""}
                        </OriginButton>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-60 p-2" sideOffset={8}>
                        <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/45">
                          Tags to apply
                        </p>
                        <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                          {tags.map((tag) => (
                            <label
                              key={tag.id}
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/[0.04]"
                            >
                              <input
                                type="checkbox"
                                checked={selectedTagIds.has(tag.id)}
                                onChange={() => toggleTag(tag.id)}
                              />
                              {tag.name}
                            </label>
                          ))}
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-2 border-t border-black/[0.06] pt-2">
                          <OriginButton
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setSelectedTagIds(new Set())}
                          >
                            Clear
                          </OriginButton>
                          <OriginButton
                            type="button"
                            size="xs"
                            variant="default"
                            disabled={busy || selectedTagIds.size === 0}
                            loading={busy}
                            onClick={applyTags}
                          >
                            Apply
                          </OriginButton>
                        </div>
                        {overTagLimit && (
                          <p className="mt-2 text-[11px] font-bold text-amber-700">
                            One bulk action covers at most {MAX_BULK_TAG_CLIENTS} — deselect some.
                          </p>
                        )}
                      </PopoverContent>
                    </Popover>
                  )}

                  {/* Assign owner — dialogs (F253) */}
                  {canAssign && (
                    <OriginButton
                      size="xs"
                      variant="ghost"
                      className="text-white/70 hover:text-white"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setPending("assign");
                      }}
                    >
                      Assign owner
                    </OriginButton>
                  )}

                  <span className="mx-0.5 h-6 w-px bg-white/15" />

                  <OriginButton
                    size="xs"
                    variant="ghost"
                    className="text-white/70 hover:text-white"
                    disabled={busy}
                    onClick={() => {
                      clear();
                      resetTransients();
                    }}
                  >
                    Clear
                  </OriginButton>
                </div>
              </div>

              {error && (
                <p
                  aria-live="polite"
                  role="alert"
                  className="border-t border-white/10 px-4 py-2 text-xs font-bold text-red-300"
                >
                  {error}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showResult && (
        <div className="pointer-events-none fixed bottom-6 inset-x-0 z-40 flex justify-center px-4">
          <p className="rounded-full bg-[#1c1a18]/90 px-5 py-2.5 text-sm font-bold text-[#f4f4ef] shadow-2xl ring-1 ring-white/25 backdrop-blur-md">
            {result}
          </p>
        </div>
      )}

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
                <p className="mt-2 text-sm leading-[1.7] text-foreground/65">
                  Clients already on {label} are left alone.
                </p>
                {statusBlocked && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-[1.7] text-amber-800">
                    <span className="font-bold">
                      {statusBlockedCount} of these {count}{" "}
                      {statusBlockedCount === 1 ? "is" : "are"} not yours to change status.
                    </span>{" "}
                    The change is all-or-nothing, so either{" "}
                    <button
                      type="button"
                      className="font-bold underline underline-offset-2 disabled:opacity-50"
                      disabled={busy}
                      onClick={deselectStatusBlocked}
                    >
                      deselect {statusBlockedCount === 1 ? "it" : "those"}
                    </button>{" "}
                    or ask an admin.
                  </p>
                )}
              </>
            ) : pending === "comment" ? (
              <>
                <p className="mt-3 text-sm leading-[1.7] text-foreground/65">
                  Each of the {count} selected client{count === 1 ? "" : "s"} gets its own copy of
                  this comment, saved against your name and the current time, including any that the
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
                  Assigning {count} client{count === 1 ? "" : "s"} in one action. Provide a reason
                  for the audit log.
                </p>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">
                    Assign to CAM
                  </span>
                  <select
                    value={assignOwnerId}
                    onChange={(e) => setAssignOwnerId(e.target.value)}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Choose a CAM</option>
                    {team.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.full_name ?? "Unnamed CAM"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">
                    Reason
                  </span>
                  <Input
                    type="text"
                    value={assignReason}
                    onChange={(e) => setAssignReason(e.target.value)}
                    placeholder="e.g. Workload redistribution"
                    className="rounded-xl border border-black/15 bg-white text-sm"
                  />
                  <span className="text-[11px] text-foreground/40">
                    Recorded in the audit log for each client
                  </span>
                </label>
                <div className="flex items-center gap-2 text-xs text-foreground/60">
                  <UsersGroupIcon className="h-4 w-4" />
                  <span>Reassigns ownership and moves open actions</span>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <OriginButton
                ref={cancelRef}
                type="button"
                variant="ghost"
                className="border border-black/10"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancel
              </OriginButton>
              <OriginButton
                type="button"
                variant="default"
                loading={busy}
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
              </OriginButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}