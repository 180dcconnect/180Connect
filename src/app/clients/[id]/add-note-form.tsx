"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * F072 — posts to /api/clients/[id]/notes. Same fetch/busy/error shape as
 * StatusSelect: on success, `router.refresh()` re-runs the Server Component
 * fetch that feeds NotesSection, so the new note appears in the list
 * immediately without hand-rolling an optimistic insert.
 *
 * The refresh runs inside `useTransition`, and `saving` stays true until the
 * transition settles: `router.refresh()` is low-priority work that React can
 * defer, so a plain `setBusy(false)` after it would flip the UI back before
 * the new note is actually on screen (it reappeared only on the next click,
 * which flushed the queue). `saving` combines both flags so the button reads
 * "Saving…" for the whole round trip plus repaint.
 */
export function AddNoteForm({
  organisationId,
  replyEventId,
}: {
  organisationId: string;
  replyEventId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!replyEventId);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saving = busy || isRefreshing;

  // Mirrors the server's own check so the button is disabled before a round
  // trip is even attempted — the request is still validated server-side
  // regardless, since that is what actually enforces it.
  const isBlank = content.trim().length === 0;

  async function save() {
    if (isBlank) {
      setError("Write something before saving.");
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/clients/${organisationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, replyEventId }),
      });
      if (response.ok) {
        setContent("");
        setSaved(true);
        startRefresh(() => router.refresh());
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

  if (!open) {
    return (
      <button
        type="button"
        className="rounded-full border border-brand/30 px-3.5 py-1.5 text-xs font-bold text-brand hover:bg-brand/5"
        onClick={() => setOpen(true)}
      >
        Add note about this reply
      </button>
    );
  }

  const fieldId = replyEventId
    ? `add-note-${organisationId}-${replyEventId}`
    : `add-note-${organisationId}`;

  return (
    <div className="mt-4">
      <label className="sr-only" htmlFor={fieldId}>
        {replyEventId ? "Add a note about this reply" : "Add a note"}
      </label>
      <textarea
        id={fieldId}
        className="w-full rounded-lg border border-black/15 p-2.5 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        disabled={saving}
        onChange={(event) => setContent(event.target.value)}
        placeholder={replyEventId ? "What should the team remember about this reply?" : "Add a note for the rest of the team…"}
        rows={3}
        value={content}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="rounded-full border border-brand/30 px-3.5 py-1.5 text-xs font-bold text-brand hover:bg-brand/5 disabled:opacity-50"
          disabled={saving || isBlank}
          onClick={save}
        >
          {saving ? "Saving…" : "Save note"}
        </button>
        {error && (
          <p aria-live="polite" role="alert" className="text-xs font-bold text-destructive">
            {error}
          </p>
        )}
        {saved && (
          <p aria-live="polite" role="status" className="text-xs font-bold text-emerald-700">
            Note saved in the client Notes list.
          </p>
        )}
      </div>
    </div>
  );
}
