"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { OriginButton } from "@/components/ui/origin-button";
import {
  attachmentUploadFailureMessage,
  buildAttachmentStoragePath,
  validateAttachmentFile,
} from "@/lib/attachments";

const ATTACHMENTS_BUCKET = "client-attachments";

/**
 * F081 — uploads directly from the browser to the private client-attachments
 * bucket (so the loading state below reflects the real transfer, not a proxy
 * through this app's server — see 20260823090000_create_attachments.sql's
 * header for the two-step shape), then POSTs the metadata to
 * /api/clients/[id]/attachments, which calls record_attachment. AC4
 * ("appears immediately… without a page reload") is router.refresh()
 * re-running the server fetch that feeds AttachmentsSection — same pattern
 * AddNoteForm uses, not a hand-rolled optimistic insert.
 *
 * AC2 asks for "progress or a loading state" — this is a loading state (a
 * spinner plus the filename, via OriginButton's own `loading` prop), not a
 * byte-level percentage bar. A real progress bar needs either raw XHR or
 * Storage's resumable upload protocol; picked the smaller, well-trodden
 * option since this ticket is explicitly a "nice to have" (P3).
 */
export function UploadAttachmentForm({ organisationId }: { organisationId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);

  const saving = busy || isRefreshing;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const validationError = validateAttachmentFile(file);
    if (validationError) {
      setError(validationError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setError(null);
    setBusy(true);
    setUploadingName(file.name);
    try {
      const supabase = createClient();
      const storagePath = buildAttachmentStoragePath(
        organisationId,
        file.name,
        crypto.randomUUID(),
      );

      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(storagePath, file, { contentType: file.type || undefined });

      if (uploadError) {
        setError(attachmentUploadFailureMessage(uploadError));
        return;
      }

      const response = await fetch(`/api/clients/${organisationId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          storagePath,
          contentType: file.type || undefined,
          sizeBytes: file.size,
        }),
      });

      if (response.ok) {
        startRefresh(() => router.refresh());
        return;
      }
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "The attachment could not be saved.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      setUploadingName(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-4 space-y-2.5">
      <OriginButton
        type="button"
        size="sm"
        variant="outline"
        loading={saving}
        disabled={saving}
        onClick={() => inputRef.current?.click()}
      >
        {saving ? (uploadingName ? `Uploading ${uploadingName}…` : "Saving…") : "Upload a file"}
      </OriginButton>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        disabled={saving}
        onChange={handleFileChange}
      />
      {error && (
        <p aria-live="polite" role="alert" className="text-xs font-bold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
