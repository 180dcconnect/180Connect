"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { OriginButton } from "@/components/ui/origin-button";
import {
  attachmentUploadFailureMessage,
  buildAttachmentStoragePath,
  formatFileSize,
  validateAttachmentFile,
  validateDraftAttachmentSet,
  type Attachment,
} from "@/lib/attachments";
import { attachDraftFile, detachDraftFile } from "./outreach-actions";

const ATTACHMENTS_BUCKET = "client-attachments";

type LinkedAttachment = { id: string; filename: string; sizeBytes: number | null };

/**
 * F217 — attach an existing or newly uploaded file to a draft before sending.
 * A client component (unlike the read-only AttachmentsSection) because it
 * needs interactive state: what's linked to THIS draft, upload progress, the
 * pick-existing list. Fetches its own linked-attachment state client-side
 * (outreach_message_attachments is shared-read, same RLS shape as
 * ATTACHMENTS) keyed by messageId, rather than page.tsx threading it through
 * — the existing-draft/follow-up queries don't need to change, and this
 * naturally refetches when generate() swaps in a new draft id.
 */
export function AttachmentPicker({
  organisationId,
  messageId,
  clientAttachments,
}: {
  organisationId: string;
  messageId: string;
  clientAttachments: readonly Attachment[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [linked, setLinked] = useState<LinkedAttachment[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExisting, setShowExisting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadLinked() {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("outreach_message_attachments")
        .select("attachments(id, filename, size_bytes)")
        .eq("outreach_message_id", messageId);
      if (cancelled) return;
      if (fetchError) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setLinked(
        (data ?? [])
          .map((row) => (Array.isArray(row.attachments) ? row.attachments[0] : row.attachments))
          .filter((row): row is { id: string; filename: string; size_bytes: number | null } => row != null)
          .map((row) => ({ id: row.id, filename: row.filename, sizeBytes: row.size_bytes })),
      );
    }
    loadLinked();
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  const currentCount = linked?.length ?? 0;
  const currentTotalSize = linked?.reduce((sum, row) => sum + (row.sizeBytes ?? 0), 0) ?? 0;
  const linkedIds = new Set((linked ?? []).map((row) => row.id));
  const pickable = clientAttachments.filter((attachment) => !linkedIds.has(attachment.id));

  async function refreshLinked(add?: LinkedAttachment, removeId?: string) {
    setLinked((current) => {
      const base = current ?? [];
      if (removeId) return base.filter((row) => row.id !== removeId);
      if (add) return [...base, add];
      return base;
    });
    router.refresh();
  }

  async function attachExisting(attachment: Attachment) {
    // Only the count cap is checked here — Attachment (unlike AttachmentRow)
    // carries a formatted sizeLabel, not raw bytes, so a combined-size
    // fast-check isn't possible client-side for this path. attach_file_to_draft
    // is the real enforcement boundary either way and returns a clear error.
    if (currentCount >= 10) {
      setError("A draft can have at most 10 attachments.");
      return;
    }
    setError(null);
    setBusy(true);
    const result = await attachDraftFile({ organisationId, messageId, attachmentId: attachment.id });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await refreshLinked({ id: attachment.id, filename: attachment.filename, sizeBytes: null });
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileError = validateAttachmentFile(file);
    if (fileError) {
      setError(fileError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const combinedError = validateDraftAttachmentSet(
      { count: currentCount, totalSizeBytes: currentTotalSize },
      { sizeBytes: file.size },
    );
    if (combinedError) {
      setError(combinedError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setError(null);
    setBusy(true);
    setUploadingName(file.name);
    try {
      const supabase = createClient();
      const storagePath = buildAttachmentStoragePath(organisationId, file.name, crypto.randomUUID());

      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(storagePath, file, { contentType: file.type || undefined });
      if (uploadError) {
        setError(attachmentUploadFailureMessage(uploadError));
        return;
      }

      const recordResponse = await fetch(`/api/clients/${organisationId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          storagePath,
          contentType: file.type || undefined,
          sizeBytes: file.size,
        }),
      });
      const recordBody = await recordResponse.json().catch(() => null);
      if (!recordResponse.ok || !recordBody?.id) {
        setError(recordBody?.error ?? "The file could not be uploaded.");
        return;
      }

      const attachResult = await attachDraftFile({
        organisationId,
        messageId,
        attachmentId: recordBody.id as string,
      });
      if (!attachResult.ok) {
        setError(attachResult.message);
        return;
      }
      await refreshLinked({ id: recordBody.id as string, filename: file.name, sizeBytes: file.size });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      setUploadingName(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove(attachmentId: string) {
    setError(null);
    setBusy(true);
    const result = await detachDraftFile({ organisationId, messageId, attachmentId });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await refreshLinked(undefined, attachmentId);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-foreground/65">Attachments</p>

      {loadError && (
        <p className="text-xs font-bold text-destructive" role="alert">
          Attachments could not be loaded. Refresh and try again.
        </p>
      )}

      {linked && linked.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {linked.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-1 text-xs"
            >
              <span className="max-w-[16rem] truncate">{attachment.filename}</span>
              {attachment.sizeBytes != null && (
                <span className="text-foreground/40">{formatFileSize(attachment.sizeBytes)}</span>
              )}
              <button
                aria-label={`Remove ${attachment.filename}`}
                className="text-foreground/40 hover:text-destructive"
                disabled={busy}
                onClick={() => handleRemove(attachment.id)}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <OriginButton
          disabled={busy}
          loading={busy && uploadingName != null}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          {uploadingName ? `Uploading ${uploadingName}…` : "Attach a file"}
        </OriginButton>
        {pickable.length > 0 && (
          <OriginButton
            disabled={busy}
            onClick={() => setShowExisting((value) => !value)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {showExisting ? "Hide client files" : "Attach an existing client file"}
          </OriginButton>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        disabled={busy}
        onChange={handleFileChange}
      />

      {showExisting && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-black/10 p-2">
          {pickable.map((attachment) => (
            <li key={attachment.id}>
              <button
                className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-black/[0.04] disabled:opacity-50"
                disabled={busy}
                onClick={() => attachExisting(attachment)}
                type="button"
              >
                {attachment.filename}
                {attachment.sizeLabel ? ` · ${attachment.sizeLabel}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p aria-live="polite" className="text-xs font-bold text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
