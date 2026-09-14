"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Trash2 } from "@/components/animate-ui/icons/trash-2";
import { deleteClientAttachment } from "./attachment-actions";

/**
 * Per-file delete control for the client profile's attachment list.
 *
 * A client component inside the otherwise server-rendered AttachmentsSection
 * because the confirm step and the per-file busy/error states need local
 * state — the same reason NotesSection owns its own delete confirmation
 * rather than the page doing it. Calls the colocated deleteClientAttachment
 * server action directly (same pattern UploadAttachmentForm uses for
 * recordUploadedAttachment), then refreshes so the removed row comes from a
 * real refetch rather than an optimistic splice.
 *
 * Renders as a single trash icon pinned to the row's right end (the row
 * itself is justify-between with the filename on the left). A failure reads
 * back on the row's own full-width line below, never squeezed beside the
 * icon.
 */
export function DeleteAttachmentButton({
  organisationId,
  attachmentId,
  filename,
}: {
  organisationId: string;
  attachmentId: string;
  filename: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteClientAttachment({ organisationId, attachmentId });
      if (result.ok) {
        startRefresh(() => router.refresh());
        return;
      }
      setError(result.message);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const locked = busy || isRefreshing;

  return (
    <>
      <button
        aria-label={`Delete ${filename}`}
        className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-black/[0.04] hover:text-stop disabled:opacity-50"
        disabled={locked}
        onClick={handleDelete}
        title={`Delete ${filename}`}
        type="button"
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Trash2 aria-hidden="true" animateOnHover size={16} />
        )}
      </button>
      {error && (
        <p
          aria-live="polite"
          className="basis-full text-xs font-semibold text-stop"
          role="alert"
        >
          {error}
        </p>
      )}
    </>
  );
}
