"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { ArrowLeft, Plus, StickyNote, X } from "lucide-react";
import type { InboxThreadView } from "@/lib/inbox-thread-view";
import { type AppRole, isViewOnly } from "@/lib/auth/permissions";
import {
  applyMentionInsertion,
  filterMentionCandidates,
  limitMentionIdsByOccurrences,
  mentionQueryAtCursor,
  splitNoteContentMentions,
  type MentionCandidate,
} from "@/lib/note-mentions";
import { MentionTag } from "@/components/ui/mention-tag";
import { Trash2 } from "@/components/animate-ui/icons/trash-2";
import { getMentionDirectory } from "@/lib/mention-directory";
import { getCaretCoordinates } from "@/lib/mention-caret-position";

const MENTION_MENU_WIDTH = 256;
const MENTION_MENU_HEIGHT = 160;
const VIEWPORT_MARGIN = 8;

const HEADER_BTN =
  "flex h-8 w-8 items-center justify-center rounded-inset text-faint transition-colors hover:bg-paper hover:text-ink cursor-pointer";

export type ClientNote = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  /** Viewer may delete it: its author, or an admin (F074 AC1). */
  canManage: boolean;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })} · ${d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}`;
}

export function ThreadNotesDrawer({
  isOpen,
  onClose,
  thread,
  viewerRole = null,
  onNotesCountChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  thread: InboxThreadView;
  viewerRole?: AppRole | null;
  onNotesCountChange?: (count: number) => void;
}) {
  const isViewer = viewerRole !== null && viewerRole !== undefined && isViewOnly(viewerRole);
  const canAddNote = !isViewer;
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Ids of notes added optimistically whose POST has not resolved yet —
  // they live only in this drawer, so deleting one skips the API call.
  const pendingTempIds = useRef(new Set<string>());

  // Mention state matching AddNoteForm (F485)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const insertedRef = useRef(new Map<string, string>());
  const [mentionedNames, setMentionedNames] = useState<string[]>([]);
  const [animatedMention, setAnimatedMention] = useState<{ name: string; key: string } | null>(
    null,
  );
  const [cursor, setCursor] = useState(0);
  const [directory, setDirectory] = useState<MentionCandidate[] | null>(null);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  // Load existing notes and teammates directory when drawer opens or thread changes
  const camOwnerName = thread.camOwner.name;

  const ensureDirectory = useCallback(() => {
    if (directory !== null || directoryFailed) return;
    void getMentionDirectory()
      .then((users) => setDirectory(users))
      .catch(() => setDirectoryFailed(true));
  }, [directory, directoryFailed]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function loadNotes() {
      try {
        const res = await fetch(`/api/clients/${thread.id}/notes`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          notes?: Array<{
            id: string;
            content: string;
            created_at: string;
            author?: { full_name?: string | null } | null;
            can_manage?: boolean;
          }>;
        };
        if (Array.isArray(data.notes) && !cancelled) {
          const loaded = data.notes.map((n) => ({
            id: n.id,
            author: n.author?.full_name || camOwnerName,
            body: n.content,
            createdAt: n.created_at,
            canManage: n.can_manage === true,
          }));
          setNotes(loaded);
          onNotesCountChange?.(loaded.length);
        }
      } catch {
        // Fall back to component state
      }
    }

    void loadNotes();
    ensureDirectory();

    return () => {
      cancelled = true;
    };
  }, [isOpen, thread.id, camOwnerName, ensureDirectory, onNotesCountChange]);

  const draftMentionParts = splitNoteContentMentions(draftNote, mentionedNames);
  const mentionTrigger = mentionQueryAtCursor(draftNote, cursor);
  const suggestions =
    mentionTrigger && directory ? filterMentionCandidates(directory, mentionTrigger.query) : [];
  const listOpen =
    mentionTrigger !== null &&
    mentionTrigger.start !== dismissedStart &&
    !directoryFailed &&
    (directory === null || suggestions.length > 0);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!listOpen || !textarea) {
      setMenuPosition(null);
      return;
    }
    const caret = getCaretCoordinates(textarea, cursor);
    const rect = textarea.getBoundingClientRect();
    const caretLeft = rect.left - textarea.scrollLeft + caret.left;
    const caretTop = rect.top - textarea.scrollTop + caret.top;

    const fitsBelow =
      caretTop + caret.lineHeight + MENTION_MENU_HEIGHT + VIEWPORT_MARGIN <= window.innerHeight;
    const top = fitsBelow
      ? caretTop + caret.lineHeight + 4
      : Math.max(VIEWPORT_MARGIN, caretTop - MENTION_MENU_HEIGHT - 4);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, caretLeft),
      window.innerWidth - MENTION_MENU_WIDTH - VIEWPORT_MARGIN,
    );
    setMenuPosition({ top, left });
  }, [listOpen, cursor, draftNote]);

  function chooseSuggestion(candidate: MentionCandidate) {
    const next = applyMentionInsertion(draftNote, cursor, candidate);
    insertedRef.current.set(candidate.id, candidate.fullName);
    setMentionedNames((prev) => Array.from(new Set([...prev, candidate.fullName])));
    setAnimatedMention({ name: candidate.fullName, key: `${candidate.id}-${next.cursor}` });
    setDraftNote(next.value);
    setActiveIndex(0);
    setDismissedStart(null);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
      setCursor(next.cursor);
      textareaRef.current?.focus();
    });
  }

  function onTextareaKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (listOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = directory === null ? [] : suggestions;
        if (items.length === 0) return;
        setActiveIndex((prev) =>
          event.key === "ArrowDown"
            ? (prev + 1) % items.length
            : (prev - 1 + items.length) % items.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const candidate = directory === null ? undefined : suggestions[activeIndex];
        if (candidate) {
          event.preventDefault();
          chooseSuggestion(candidate);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (mentionTrigger) setDismissedStart(mentionTrigger.start);
        return;
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleAddNote();
    }
  }

  async function handleAddNote() {
    const body = draftNote.trim();
    if (!body || saving) return;

    setSaving(true);
    setSaveError(null);

    const mentionedUsers = limitMentionIdsByOccurrences(
      draftNote,
      [...insertedRef.current.entries()].map(([id, name]) => ({ id, name })),
    )
      .map((id) => ({ id, name: insertedRef.current.get(id) ?? "" }))
      .filter((user) => user.name !== "");

    const tempId = `${thread.id}-note-${Date.now()}`;
    const optimisticNote: ClientNote = {
      id: tempId,
      author: thread.camOwner.name,
      body,
      createdAt: new Date().toISOString(),
      // The viewer just wrote it, so they may delete it.
      canManage: true,
    };
    pendingTempIds.current.add(tempId);

    // Notify the parent outside the updater below: updater functions must
    // stay pure (React may re-run them during render), so calling the
    // parent's setState inside one warns "cannot update a component while
    // rendering a different component". The `saving` guard above rules out
    // overlapping saves, so the `notes` closure here is current.
    const nextNotes = [optimisticNote, ...notes];
    setNotes(nextNotes);
    onNotesCountChange?.(nextNotes.length);
    setDraftNote("");
    insertedRef.current.clear();
    setMentionedNames([]);
    setAnimatedMention(null);

    try {
      const response = await fetch(`/api/clients/${thread.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: body,
          mentionedUsers,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        note?: { id: string; created_at: string };
      } | null;

      if (!response.ok) {
        setSaveError(payload?.error ?? "Could not save note.");
      } else if (payload?.note && typeof payload.note.id === "string") {
        // Swap the temporary id for the real one, so the note can be
        // deleted without waiting for a reload. Pure updater — no
        // side effects inside.
        const savedId = payload.note.id;
        const savedAt = payload.note.created_at;
        pendingTempIds.current.delete(tempId);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === tempId
              ? {
                  ...n,
                  id: savedId,
                  createdAt: typeof savedAt === "string" ? savedAt : n.createdAt,
                }
              : n,
          ),
        );
      }
    } catch {
      // Soft-fail: note remains in state
    } finally {
      setSaving(false);
    }
  }

  // F074 in the thread drawer: the viewer may delete their own notes (or any
  // note as an admin) without leaving the thread. The button only renders
  // for manageable notes and the API re-checks anyway. A plain `confirm()`
  // like NotesSection uses — another action with no undo from the UI.
  async function handleDeleteNote(noteId: string) {
    if (deletingId !== null) return;
    if (!notes.some((n) => n.id === noteId)) return;
    if (!confirm("Delete this note? This cannot be undone.")) return;

    setDeletingId(noteId);
    setDeleteError(null);

    const snapshot = notes;
    const remaining = notes.filter((n) => n.id !== noteId);
    setNotes(remaining);
    onNotesCountChange?.(remaining.length);

    // Still waiting on its POST — it lives only in this drawer, so there
    // is no server row to delete.
    if (pendingTempIds.current.has(noteId)) {
      pendingTempIds.current.delete(noteId);
      setDeletingId(null);
      return;
    }

    try {
      const response = await fetch(`/api/clients/${thread.id}/notes/${noteId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotes(snapshot);
        onNotesCountChange?.(snapshot.length);
        setDeleteError(payload?.error ?? "The note could not be deleted.");
      }
    } catch {
      setNotes(snapshot);
      onNotesCountChange?.(snapshot.length);
      setDeleteError("Could not reach the server. Check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  const allKnownMentionNames = Array.from(
    new Set([
      ...(directory?.map((d) => d.fullName) ?? []),
      ...mentionedNames,
    ]),
  );

  return (
    <motion.div
      key="client-notes"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-y-0 right-0 z-30 flex w-[35%] min-w-[300px] flex-col border-l border-rule-soft bg-white shadow-[-18px_0_40px_-24px_rgba(15,23,42,0.25)]"
    >
      {/* Header — clean navigation without border-b, without note icon, and without title text */}
      <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          title="Back to the thread"
          className={HEADER_BTN}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className={`${HEADER_BTN} ml-auto`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Add a note with @teammate mention support */}
      {canAddNote && (
        <div className="shrink-0 border-b border-rule-soft px-6 py-4">
          <div className="relative min-h-[5.5rem] rounded-inset border border-rule bg-paper">
          {/* Overlay renders @mentions with blue highlight, matching AddNoteForm */}
          <div
            ref={overlayRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2 text-[13px] leading-[1.6] break-words whitespace-pre-wrap"
          >
            {draftMentionParts.map((part, index) =>
              part.mention ? (
                <MentionTag
                  key={`${index}-${part.text}-${animatedMention?.key ?? ""}`}
                  text={part.text}
                  variant="light"
                  animate={animatedMention?.name === part.text.slice(1)}
                  // Metric-stable: the overlay sits under a transparent
                  // textarea, so the highlight must measure like plain text
                  // or the caret drifts from the visible glyphs.
                  matchTextarea
                />
              ) : (
                <span key={index} className="text-ink">
                  {part.text}
                </span>
              ),
            )}
          </div>

          {!draftNote && (
            <span className="pointer-events-none absolute top-2 left-3 text-[13px] text-faint select-none">
              Add a note… (type @ to mention a teammate)
            </span>
          )}

          <textarea
            ref={textareaRef}
            value={draftNote}
            onChange={(e) => {
              setDraftNote(e.target.value);
              setActiveIndex(0);
              setDismissedStart(null);
              setCursor(e.target.selectionStart ?? e.target.value.length);
              if (mentionQueryAtCursor(e.target.value, e.target.selectionStart ?? 0)) {
                ensureDirectory();
              }
            }}
            onSelect={() => setCursor(textareaRef.current?.selectionStart ?? draftNote.length)}
            onKeyDown={onTextareaKeyDown}
            onScroll={(e) => {
              if (overlayRef.current) {
                overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
            rows={3}
            spellCheck
            disabled={saving}
            className="relative w-full min-h-[5.5rem] resize-y bg-transparent px-3 py-2 text-[13px] leading-[1.6] whitespace-pre-wrap break-words text-transparent outline-none focus:border-lead focus:outline-none"
            style={{ caretColor: "var(--ink)" }}
          />
        </div>

        {/* Mention suggestion popup */}
        {listOpen &&
          menuPosition &&
          createPortal(
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              role="presentation"
              style={{ top: menuPosition.top, left: menuPosition.left }}
              className="fixed z-[60] w-64 overflow-hidden rounded-panel border border-rule bg-white p-1 shadow-[0_18px_40px_-18px_rgba(20,26,34,0.32)]"
            >
              {directory === null ? (
                <p className="px-2.5 py-2 text-xs text-dim" role="status">
                  Finding teammates…
                </p>
              ) : (
                <ul
                  id="thread-note-mentions"
                  role="listbox"
                  aria-label="Mention a teammate"
                  className="max-h-36 overflow-y-auto"
                >
                  {suggestions.map((candidate, index) => (
                    <li
                      key={candidate.id}
                      id={`thread-note-mentions-${candidate.id}`}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <button
                        type="button"
                        className={`flex w-full items-center gap-1.5 rounded-inset px-2.5 py-1.5 text-left text-sm transition-colors cursor-pointer ${
                          index === activeIndex
                            ? "bg-paper font-semibold text-ink"
                            : "text-dim hover:bg-paper/70 hover:text-ink"
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={() => chooseSuggestion(candidate)}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <span
                          aria-hidden="true"
                          className={`font-semibold ${index === activeIndex ? "text-lead-mid" : "text-faint"}`}
                        >
                          @
                        </span>
                        {candidate.fullName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>,
            document.body,
          )}

        {saveError && (
          <p className="mt-1.5 text-[11px] font-semibold text-stop" role="alert">
            {saveError}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-faint">⌘↵ to save</span>
          <button
            type="button"
            onClick={() => void handleAddNote()}
            disabled={!draftNote.trim() || saving}
            className="flex items-center gap-1.5 rounded-inset bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {deleteError && (
          <p className="mb-3 text-[11px] font-semibold text-stop" role="alert">
            {deleteError}
          </p>
        )}
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <StickyNote className="mb-3 h-10 w-10 text-faint stroke-[1.5]" />
            <p className="text-[13px] font-semibold text-ink">No notes yet</p>
            <p className="mt-1 text-[12px] text-dim">
              {canAddNote
                ? `Add the first note about ${thread.orgName} above.`
                : `No notes have been added for ${thread.orgName}.`}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => {
              const parts = splitNoteContentMentions(note.body, allKnownMentionNames);
              return (
                <li
                  key={note.id}
                  className="rounded-panel border border-rule-soft bg-paper p-4"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lead text-[10px] font-semibold text-white">
                      {getInitials(note.author)}
                    </div>
                    <span className="text-[12px] font-semibold text-ink">
                      {note.author}
                    </span>
                    <span className="text-[11px] text-faint" suppressHydrationWarning>
                      {formatNoteDate(note.createdAt)}
                    </span>
                    {note.canManage && !isViewer && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteNote(note.id)}
                        disabled={deletingId !== null}
                        title="Delete this note"
                        aria-label="Delete this note"
                        className="ml-auto grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:text-stop disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={16} animateOnHover />
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[13px] leading-[1.6] text-ink whitespace-pre-wrap">
                    {parts.map((part, index) =>
                      part.mention ? (
                        <MentionTag key={index} text={part.text} variant="light" animate={false} />
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
