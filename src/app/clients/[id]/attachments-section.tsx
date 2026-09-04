import type { Attachment } from "@/lib/attachments";
import { extractAttachmentTextForm } from "./attachment-actions";

/**
 * F080 — list / empty / error states for a client's attachments (AC1, AC3).
 * No interactivity, so this stays a server component: the "Open" link is a
 * plain anchor to the download route, which does the signed-URL exchange and
 * redirects — nothing here needs client-side state.
 */
export function AttachmentsSection({
  organisationId,
  attachments,
  error,
  canExtract,
}: {
  organisationId: string;
  attachments: readonly Attachment[];
  error: boolean;
  canExtract: boolean;
}) {
  if (error) {
    return (
      <p className="mt-4 text-sm font-bold text-destructive" role="alert">
        Attachments could not be loaded. Refresh and try again.
      </p>
    );
  }

  if (attachments.length === 0) {
    return (
      <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
        No files have been attached to this client yet.
      </p>
    );
  }

  return (
    <ul className="mt-4 divide-y divide-black/[0.05]">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            {/* AC2: opens (new tab) or downloads from this one link — the route
                behind it exchanges the row for a short-lived signed URL, since
                the bucket is private. */}
            <a
              className="break-all text-sm font-bold text-brand-hover underline underline-offset-2 hover:text-brand"
              href={`/api/clients/${organisationId}/attachments/${attachment.id}/download`}
              rel="noreferrer"
              target="_blank"
            >
              {attachment.filename}
            </a>
            <p className="mt-0.5 text-[12px] text-foreground/40">
              Added by {attachment.uploadedByName} on{" "}
              {new Date(attachment.createdAt).toLocaleDateString("en-GB")}
              {attachment.sizeLabel ? ` · ${attachment.sizeLabel}` : ""}
            </p>
            {attachment.textExtractionStatus === "succeeded" && attachment.extractedText && (
              <details className="mt-2 max-w-2xl text-xs text-foreground/65">
                <summary className="cursor-pointer font-bold text-brand-hover">
                  Text extracted{attachment.extractedPageCount ? ` · ${attachment.extractedPageCount} pages` : ""}
                  {attachment.extractedTextTruncated ? " · shortened" : ""}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black/[0.03] p-3 font-sans leading-relaxed">
                  {attachment.extractedText}
                </pre>
              </details>
            )}
            {attachment.textExtractionStatus === "failed" && (
              <p className="mt-1 text-xs font-bold text-destructive">
                Text could not be extracted. This PDF may be scanned or image-only.
              </p>
            )}
            {canExtract && (attachment.textExtractionStatus === "pending" || attachment.textExtractionStatus === "failed") && (
              <form action={extractAttachmentTextForm} className="mt-2">
                <input type="hidden" name="organisationId" value={organisationId} />
                <input type="hidden" name="attachmentId" value={attachment.id} />
                <button className="text-xs font-bold text-brand-hover underline underline-offset-2" type="submit">
                  {attachment.textExtractionStatus === "failed" ? "Try extraction again" : "Extract text"}
                </button>
              </form>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
