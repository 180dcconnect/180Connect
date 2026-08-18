/**
 * F071/F072 — notes-section logic behind the client detail page, kept out of
 * the route so it can be tested without a database (same split as
 * @/lib/client-basic-info and @/lib/outreach-history).
 */

export type NoteRow = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string | null;
  author_id: string | null;
  /** Embedded via `users!notes_author_id_fkey` — null for a deleted author's
   * account (`author_id` itself goes null too, on delete set null) or a row
   * PostgREST could not embed. */
  author: { full_name: string | null } | null;
};

export type DisplayNote = {
  id: string;
  content: string;
  authorName: string;
  createdAt: string;
  edited: boolean;
};

/**
 * Shown for a note whose author can't be identified — an account that was
 * later deleted (`notes.author_id` is `on delete set null` specifically so the
 * note survives that), or a missing embed. Same phrasing the ownership section
 * already uses for a departed owner, for consistency across the page.
 */
export const UNKNOWN_AUTHOR = "A former team member";

/**
 * Orders notes newest-first (F071 AC3) — a stable order rather than one that
 * can shuffle between visits, and it matches `notes_organisation_idx`'s own
 * `(organisation_id, created_at desc)` shape.
 */
export function orderNotesNewestFirst(rows: readonly NoteRow[]): NoteRow[] {
  return [...rows].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}

/** Builds what the page actually renders for one note (F071 AC2). */
export function buildDisplayNote(row: NoteRow): DisplayNote {
  return {
    id: row.id,
    content: row.content,
    authorName: row.author?.full_name ?? UNKNOWN_AUTHOR,
    createdAt: row.created_at,
    edited: Boolean(row.updated_at),
  };
}
