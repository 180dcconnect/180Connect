import Link from "next/link";
import type { Attachment } from "@/lib/attachments";
import { textExtractionFailureCopy } from "@/lib/attachments";
import { LinkAttachmentForm, type TimelineLinkOption } from "./link-attachment-form";
import { extractAttachmentTextForm } from "./attachment-actions";

/**
 * F080 — list / empty / error states for a client's attachments (AC1, AC3),
 * with F219's per-row "link to a timeline event" control and F220's extraction
 * states, retry, and text search layered on top. No client-side state, so this
 * stays a server component: the "Open" link is a plain anchor to the download
 * route (which does the signed-URL exchange and redirects), the timeline link
 * and extraction actions are server actions, and the text search below is a
 * plain GET form whose results come back through the page's searchParams.
 *
 * F220 follow-up — attachment text search: the search box submits
 * `?attachmentSearch=…` to the same client page, whose server component runs
 * a full-text query against the attachments.extracted_text_search GIN index
 * (scoped to this organisation) and passes the matches back in here. That is
 * what makes AC1's "searchable" true end-to-end; without a consumer the index
 * only existed on the row. Searches extracted PDF text only — scanned and
 * not-yet-extracted files have no text and therefore can't match, which the
 * result copy below says rather than implying otherwise.
 */
export function AttachmentsSection({
  organisationId,
  attachments,
  totalCount,
  search,
  error,
  canExtract,
  canLink,
  timelineOptions,
}: {
  organisationId: string;
  attachments: readonly Attachment[];
  /** Number of files before any search filter, so results can say "N of M". */
  totalCount: number;
  /** Non-null while an attachment-text search is active. */
  search?: { query: string; failed?: boolean } | null;
  error: boolean;
  canExtract: boolean;
  canLink: boolean;
  timelineOptions: readonly TimelineLinkOption[];
}) {
  if (error) {
    return (
      <p className="mt-3.5 text-sm font-semibold text-stop" role="alert">
        Attachments could not be loaded. Refresh and try again.
      </p>
    );
  }

  const searching = Boolean(search);

  return (
    <div className="mt-3.5 space-y-2.5">
      {(totalCount > 0 || searching) && (
        <form
          action={`/clients/${organisationId}`}
          className="flex flex-wrap items-center gap-2"
          method="get"
          role="search"
        >
          <label className="sr-only" htmlFor="attachment-search">
            Search text extracted from this client&apos;s files
          </label>
          <input
            className="w-full max-w-xs rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] focus:border-black/25 focus:ring-[3px] focus:ring-black/10"
            defaultValue={search?.query ?? ""}
            id="attachment-search"
            name="attachmentSearch"
            placeholder="Search extracted PDF text"
            type="search"
          />
          <button
            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-bold text-foreground/70 transition-colors hover:bg-black/[0.03] hover:text-foreground/90"
            type="submit"
          >
            Search files
          </button>
          {searching && (
            <Link
              className="text-xs font-semibold text-brand underline underline-offset-2"
              href={`/clients/${organisationId}`}
            >
              Clear search
            </Link>
          )}
        </form>
      )}

      {search?.failed && (
        <p className="text-xs font-semibold text-stop" role="alert">
          File search could not be run. Showing all files instead.
        </p>
      )}

      {attachments.length === 0 ? (
        searching ? (
          <p className="text-sm leading-[1.6] text-faint">
            No extracted file text matches “{search?.query}”. Searches look inside
            PDF text only — scanned or not-yet-extracted files can&apos;t match.{" "}
            <Link
              className="font-semibold text-brand underline underline-offset-2"
              href={`/clients/${organisationId}`}
            >
              Clear search
            </Link>
            .
          </p>
        ) : (
          <p className="mt-3.5 text-sm leading-[1.6] text-faint">
            No files have been attached to this client yet.
          </p>
        )
      ) : (
        <>
          {searching && !search?.failed && (
            <p className="text-[12px] font-medium text-foreground/45">
              {attachments.length === totalCount
                ? `${totalCount} file${totalCount === 1 ? "" : "s"} match`
                : `Matched ${attachments.length} of ${totalCount} file${totalCount === 1 ? "" : "s"}`}{" "}
              — text extracted from PDFs only.
            </p>
          )}
          <ul className="divide-y divide-black/[0.05]">
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
                    className="break-all text-sm font-semibold text-lead underline underline-offset-2 hover:text-lead-mid"
                    href={`/api/clients/${organisationId}/attachments/${attachment.id}/download`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {attachment.filename}
                  </a>
                  <p className="mt-0.5 text-[12px] text-faint">
                    Added by {attachment.uploadedByName} on{" "}
                    {new Date(attachment.createdAt).toLocaleDateString("en-GB")}
                    {attachment.sizeLabel ? ` · ${attachment.sizeLabel}` : ""}
                  </p>
                  {canLink && (
                    <LinkAttachmentForm
                      organisationId={organisationId}
                      attachmentId={attachment.id}
                      currentKey={
                        attachment.timelineContextType === "client"
                          ? "client"
                          : `${attachment.timelineContextType}:${attachment.timelineContextId}`
                      }
                      options={timelineOptions}
                    />
                  )}
                  {attachment.textExtractionStatus === "succeeded" && attachment.extractedText && (
                    <details className="mt-2 max-w-2xl text-xs text-foreground/65">
                      <summary className="cursor-pointer font-semibold text-brand">
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
                      {textExtractionFailureCopy(attachment.textExtractionFailureReason)}
                    </p>
                  )}
                  {canExtract && (attachment.textExtractionStatus === "pending" || attachment.textExtractionStatus === "failed") && (
                    <form action={extractAttachmentTextForm} className="mt-2">
                      <input type="hidden" name="organisationId" value={organisationId} />
                      <input type="hidden" name="attachmentId" value={attachment.id} />
                      <button className="text-xs font-semibold text-brand underline underline-offset-2" type="submit">
                        {attachment.textExtractionStatus === "failed" ? "Try extraction again" : "Extract text"}
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
