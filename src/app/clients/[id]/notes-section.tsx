"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NoteListItem } from "@/lib/note-history";

import { formatShortDate } from "@/lib/display-format";

/**
 * F071 (list) / F073 (edit) / F074 (delete): every note left against this
 * client, from any CAM (F071 AC1), newest first (F071 AC3). Each note shows
 * who wrote it and when, and "· edited" once `updated_at` is set (F073 AC2).
 * `canManage` per note is computed server-side (`note-history.ts`'s
 * `buildNoteList` — author or admin, mirroring `notes_update_own` /
 * `notes_delete_own`, which share the same predicate), so this component only
 * renders what it is told rather than re-deriving who is allowed to act on
 * what.
 *
 * A client component, not a server one, because the edit toggle and the
 * delete confirmation both need local state per note — same reasoning
 * UserManagementTable and StatusSelect already have on this page.
 *
 * After a successful edit or delete the `router.refresh()` runs inside
 * `useTransition`, and every note's controls stay disabled until it settles:
 * refresh is low-priority work React can defer, so re-enabling on the fetch
 * alone left the list stale until the next click flushed the queue. The
 * "Saving…"/"Deleting…" labels stay per-note (only the acted-on note shows
 * them) while `refreshing` holds the whole section non-interactive.
 */
export function NotesSection({
  notes,
  error,
  organisationId,
  addNoteForm,
}: {
  notes: NoteListItem[];
  error: boolean;
  organisationId: string;
  addNoteForm?: React.ReactNode;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();
  // Scoped to a specific note, not a single shared string — busyId briefly
  // returns to null for every note once a request settles, so a shared error
  // would flash under every manageable note instead of just the one that
  // actually failed.
  const [errorNoteId, setErrorNoteId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function startEdit(note: NoteListItem) {
    setEditingId(note.id);
    setDraft(note.content);
    setErrorNoteId(null);
    setFormError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setErrorNoteId(null);
    setFormError(null);
  }

  async function saveEdit(noteId: string) {
    if (draft.trim().length === 0) {
      setErrorNoteId(noteId);
      setFormError("Write something before saving.");
      return;
    }

    setBusyId(noteId);
    setErrorNoteId(null);
    setFormError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (response.ok) {
        setEditingId(null);
        // Re-runs the Server Component fetch, so the edited content and the
        // "edited" marker both come from a real refetch (F073 AC3: in place,
        // not a second note) rather than an optimistic guess at the new
        // updated_at.
        startRefresh(() => router.refresh());
        return;
      }
      const body = await response.json();
      setErrorNoteId(noteId);
      setFormError(body.error ?? "The note could not be saved.");
    } catch {
      setErrorNoteId(noteId);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  // F074 AC3: a plain `confirm()` rather than a custom dialog — the same
  // pattern PendingInvitesList already uses for cancelling an invite, another
  // action with no undo from the UI.
  async function deleteNote(note: NoteListItem) {
    if (!confirm("Delete this note? This cannot be undone.")) return;

    setBusyId(note.id);
    setErrorNoteId(null);
    setFormError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/notes/${note.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        startRefresh(() => router.refresh());
        return;
      }
      const body = await response.json();
      setErrorNoteId(note.id);
      setFormError(body.error ?? "The note could not be deleted.");
    } catch {
      setErrorNoteId(note.id);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return (
      <p className="mt-4 text-sm font-semibold text-stop" role="alert">
        Notes could not be loaded. Refresh and try again.
      </p>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="mt-4">
        <p className="text-sm leading-[1.7] text-dim">No notes yet.</p>
        {addNoteForm && <div className="mt-3">{addNoteForm}</div>}
      </div>
    );
  }

  return (
    <ul className="mt-4 space-y-3">
      {notes.map((note) => {
        const busy = busyId === note.id;
        // Labels stay per-note (only the acted-on note says Saving…/Deleting…),
        // but everything is non-interactive while the post-refresh repaint is
        // pending too.
        const locked = busy || isRefreshing;
        return (
          <li key={note.id} className="rounded-inset border border-rule p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-dim">
              <span className="font-semibold text-dim">{note.authorName}</span>
              <span>
                {formatShortDate(note.createdAt)}
                {note.edited ? " · edited" : ""}
              </span>
            </div>

            {editingId === note.id ? (
              <div className="mt-2.5">
                <label className="sr-only" htmlFor={`edit-note-${note.id}`}>
                  Edit note
                </label>
                <textarea
                  id={`edit-note-${note.id}`}
                  className="w-full rounded-inset border border-rule p-2.5 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-lead-mid/20"
                  disabled={locked}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  value={draft}
                />
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    className="rounded-full border border-rule px-3.5 py-1.5 text-xs font-semibold text-lead hover:bg-lead-wash disabled:opacity-50"
                    disabled={locked}
                    onClick={() => saveEdit(note.id)}
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-dim hover:text-dim disabled:opacity-50"
                    disabled={locked}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </button>
                  {errorNoteId === note.id && formError && (
                    <p aria-live="polite" role="alert" className="text-xs font-semibold text-stop">
                      {formError}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <p className="mt-2.5 whitespace-pre-wrap text-sm leading-[1.65] text-ink">
                  {note.content}
                </p>
                {note.canManage && (
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      className="text-xs font-semibold text-dim hover:text-dim disabled:opacity-50"
                      disabled={locked}
                      onClick={() => startEdit(note)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-stop/70 hover:text-stop disabled:opacity-50"
                      disabled={locked}
                      onClick={() => deleteNote(note)}
                    >
                      {busy ? "Deleting…" : "Delete"}
                    </button>
                    {errorNoteId === note.id && formError && (
                      <p aria-live="polite" role="alert" className="text-xs font-semibold text-stop">
                        {formError}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
