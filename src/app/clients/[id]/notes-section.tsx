import { buildDisplayNote, orderNotesNewestFirst, type NoteRow } from "@/lib/note-history";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * F071: every note left against this client, from any CAM (AC1) — RLS
 * (`notes_select_active`) already shares read across every active role, so
 * nothing here filters by author. Each entry shows who wrote it and when
 * (AC2), newest first (AC3, `orderNotesNewestFirst`). F072's AddNoteForm
 * (rendered alongside this, in page.tsx) is what populates this list.
 */
export function NotesSection({ notes, error }: { notes: NoteRow[]; error: boolean }) {
  if (error) {
    return (
      <p className="mt-3 text-sm font-medium text-red-800" role="alert">
        Notes could not be loaded. Refresh and try again.
      </p>
    );
  }

  if (notes.length === 0) {
    return <p className="mt-3 text-sm text-foreground/65">No notes yet.</p>;
  }

  const ordered = orderNotesNewestFirst(notes).map(buildDisplayNote);

  return (
    <ul className="mt-3 space-y-3">
      {ordered.map((note) => (
        <li key={note.id} className="rounded-lg border border-black/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-foreground/60">
            <span className="font-bold text-foreground/80">{note.authorName}</span>
            <span>
              {formatDate(note.createdAt)}
              {note.edited ? " · edited" : ""}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{note.content}</p>
        </li>
      ))}
    </ul>
  );
}
