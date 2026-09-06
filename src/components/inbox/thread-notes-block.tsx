"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { formatExactTime } from "@/lib/display-format";
import type { DisplayNote } from "@/lib/note-history";

/**
 * The rail's notes block: the newest few notes on this client, plus a quick
 * add. Reading a thread is when a CAM remembers something worth writing down —
 * "Jamie prefers Tuesdays" — and making them navigate to the client page to
 * record it is how that note doesn't get written.
 *
 * Writes go to the SAME endpoint the client page's AddNoteForm posts to
 * (POST /api/clients/[id]/notes), not a second one: that route already owns
 * validation, the `client:edit` gate, and setting author_id from the session
 * rather than the request body.
 *
 * Editing and deleting stay on the client page (NotesSection). This is a
 * capture surface, not a note manager — `canManage` is computed there and has
 * no meaning for the three-line previews shown here.
 */

const MAX_NOTE_LENGTH = 4000;

export function ThreadNotesBlock({
  organisationId,
  notes,
  totalCount,
  canAdd,
  error,
}: {
  organisationId: string;
  /** Already trimmed to the few the rail shows, newest first. */
  notes: readonly DisplayNote[];
  /** How many exist in total, so the "View all" link can say so. */
  totalCount: number;
  /** False for viewers — the same population `client:edit` gates server-side. */
  canAdd: boolean;
  error: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFailure(body.error ?? "The note could not be saved. Try again.");
        return;
      }
      setContent("");
      setAdding(false);
      // The rail is server-rendered from the route's notes query, so the new
      // note appears by re-rendering it rather than by inserting into local
      // state — one source of truth for what this client's notes are.
      startRefresh(() => router.refresh());
    } catch {
      setFailure("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <p className="text-[13px] font-semibold text-stop" role="alert">
        Notes could not be loaded.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-[13px] leading-[1.6] text-dim">No notes on this client yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {notes.map((note) => (
            <li key={note.id}>
              <p className="line-clamp-3 text-[13px] leading-[1.6] text-ink">
                {note.content}
              </p>
              <p className="mt-0.5 text-[11.5px] text-faint">
                {note.authorName} · {formatExactTime(new Date(note.createdAt))}
                {note.edited ? " · edited" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canAdd &&
        (adding ? (
          <form className="space-y-2" onSubmit={submit}>
            <label className="sr-only" htmlFor="rail-note-content">
              Note
            </label>
            <textarea
              autoFocus
              className="w-full rounded-inset border border-rule bg-white px-3 py-2 text-[13px] leading-[1.6] text-ink placeholder:text-faint focus:border-lead-mid focus:ring-1 focus:ring-lead-mid focus:outline-none"
              disabled={saving}
              id="rail-note-content"
              maxLength={MAX_NOTE_LENGTH}
              onChange={(event) => setContent(event.target.value)}
              placeholder="What should the next person know?"
              rows={4}
              value={content}
            />
            {failure && (
              <p className="text-[12px] font-semibold text-stop" role="alert">
                {failure}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                disabled={saving || refreshing || !content.trim()}
                type="submit"
              >
                {saving ? "Saving…" : "Save note"}
              </button>
              <button
                className="rounded-full border border-rule px-3 py-1.5 text-[12px] font-semibold text-dim disabled:opacity-60"
                disabled={saving}
                onClick={() => {
                  setAdding(false);
                  setFailure(null);
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-lead transition-colors hover:underline"
            onClick={() => setAdding(true)}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Add a note
          </button>
        ))}

      {totalCount > notes.length && (
        <Link
          className="block text-[12px] font-semibold text-lead underline underline-offset-2"
          href={`/clients/${organisationId}/activity`}
        >
          View all {totalCount} notes
        </Link>
      )}
    </div>
  );
}
