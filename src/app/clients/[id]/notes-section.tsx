"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NoteListItem } from "@/lib/note-history";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * F071 (list) / F073 (edit): every note left against this client, from any
 * CAM (F071 AC1), newest first (F071 AC3). Each note shows who wrote it and
 * when, and "· edited" once `updated_at` is set (F073 AC2). `canEdit` per
 * note is computed server-side (`note-history.ts`'s `buildNoteList` — author
 * or admin, mirroring `notes_update_own`), so this component only renders
 * what it is told rather than re-deriving who is allowed to edit what.
 *
 * A client component, not a server one, because the edit toggle needs local
 * state per note — same reasoning UserManagementTable and StatusSelect
 * already have on this page.
 */
export function NotesSection({
  notes,
  error,
  organisationId,
}: {
  notes: NoteListItem[];
  error: boolean;
  organisationId: string;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function startEdit(note: NoteListItem) {
    setEditingId(note.id);
    setDraft(note.content);
    setFormError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setFormError(null);
  }

  async function saveEdit(noteId: string) {
    if (draft.trim().length === 0) {
      setFormError("Write something before saving.");
      return;
    }

    setBusy(true);
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
        router.refresh();
        return;
      }
      const body = await response.json();
      setFormError(body.error ?? "The note could not be saved.");
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <p className="mt-4 text-sm font-bold text-destructive" role="alert">
        Notes could not be loaded. Refresh and try again.
      </p>
    );
  }

  if (notes.length === 0) {
    return <p className="mt-4 text-sm leading-[1.7] text-foreground/45">No notes yet.</p>;
  }

  return (
    <ul className="mt-4 space-y-3">
      {notes.map((note) => (
        <li key={note.id} className="rounded-xl border border-black/[0.06] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-foreground/45">
            <span className="font-bold text-foreground/70">{note.authorName}</span>
            <span>
              {formatDate(note.createdAt)}
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
                className="w-full rounded-lg border border-black/15 p-2.5 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                value={draft}
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  className="rounded-full border border-brand/30 px-3.5 py-1.5 text-xs font-bold text-brand hover:bg-brand/5 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => saveEdit(note.id)}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="text-xs font-bold text-foreground/45 hover:text-foreground/70 disabled:opacity-50"
                  disabled={busy}
                  onClick={cancelEdit}
                >
                  Cancel
                </button>
                {formError && (
                  <p aria-live="polite" role="alert" className="text-xs font-bold text-destructive">
                    {formError}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="mt-2.5 whitespace-pre-wrap text-sm leading-[1.65] text-foreground/80">
                {note.content}
              </p>
              {note.canEdit && (
                <button
                  type="button"
                  className="mt-2 text-xs font-bold text-foreground/45 hover:text-foreground/70"
                  onClick={() => startEdit(note)}
                >
                  Edit
                </button>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
