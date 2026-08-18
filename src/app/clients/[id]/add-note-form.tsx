"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * F072 — posts to /api/clients/[id]/notes. Same fetch/busy/error shape as
 * StatusSelect: on success, `router.refresh()` re-runs the Server Component
 * fetch that feeds NotesSection, so the new note appears in the list
 * immediately (AC4) without hand-rolling an optimistic insert that would need
 * to guess the author's display name and risk it disagreeing with what a
 * real refetch shows.
 */
export function AddNoteForm({ organisationId }: { organisationId: string }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the server's own check (AC3) so the button is disabled before a
  // round trip is even attempted — the request is still validated server-side
  // regardless, since that is what actually enforces it.
  const isBlank = content.trim().length === 0;

  async function save() {
    if (isBlank) {
      setError("Write something before saving.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (response.ok) {
        setContent("");
        router.refresh();
        return;
      }
      const body = await response.json();
      setError(body.error ?? "The note could not be saved.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <label className="sr-only" htmlFor={`add-note-${organisationId}`}>
        Add a note
      </label>
      <textarea
        id={`add-note-${organisationId}`}
        className="w-full rounded-lg border border-black/15 p-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        disabled={busy}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Add a note for the rest of the team…"
        rows={3}
        value={content}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="rounded-full border border-brand/30 px-4 py-2 text-xs font-bold text-brand hover:bg-brand/5 disabled:opacity-50"
          disabled={busy || isBlank}
          onClick={save}
        >
          {busy ? "Saving…" : "Save note"}
        </button>
        {error && (
          <p aria-live="polite" role="alert" className="text-sm font-bold text-red-800">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
