/**
 * F080 View Client Attachments / F081 Upload Client Attachment.
 *
 * Formatting and validation logic behind the client profile's attachment list
 * and upload form, kept out of the page/route/component so it can be tested
 * without a database (same split as @/lib/source-tracking and
 * @/lib/note-history).
 *
 * Writes go through record_attachment (20260823090000_create_attachments.sql)
 * after the file itself lands in the private `client-attachments` Storage
 * bucket — see that migration's header for the two-step upload/record shape
 * and the size/type limits enforced there (kept in sync with the constants
 * below by hand; the migration comment says so).
 */

export type AttachmentRow = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  text_extraction_status: "pending" | "succeeded" | "failed" | "not_applicable";
  extracted_text: string | null;
  extracted_page_count: number | null;
  extracted_text_truncated: boolean;
  uploaded_by_user: { full_name: string | null } | null;
};

export type Attachment = {
  id: string;
  filename: string;
  contentType: string | null;
  sizeLabel: string | null;
  createdAt: string;
  uploadedByName: string;
  textExtractionStatus: AttachmentRow["text_extraction_status"];
  extractedText: string | null;
  extractedPageCount: number | null;
  extractedTextTruncated: boolean;
};

const UNKNOWN_UPLOADER = "A former team member";
export const MAX_ATTACHMENT_EMAIL_CONTEXT_CHARACTERS = 30_000;

/** Bounds attachment context before it reaches a paid model prompt. */
export function buildAttachmentEmailContext(
  rows: readonly { filename: string; extracted_text: string | null }[],
): string | null {
  const blocks = rows
    .filter((row) => row.extracted_text?.trim())
    .map((row) => `File: ${row.filename}\n${row.extracted_text!.trim()}`);
  if (blocks.length === 0) return null;
  return blocks.join("\n\n").slice(0, MAX_ATTACHMENT_EMAIL_CONTEXT_CHARACTERS);
}

/** Binary units, matching how a CAM would actually read a file size ("2.4 MB"). */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

/**
 * Converts raw attachment rows into display-ready entries, newest first — same
 * "attach a label, drop what can't be shown safely, sort predictably" shape as
 * `formatOrganisationSources`. A row with a blank filename is dropped rather
 * than shown as an unreadable link (AC2 needs a filename to display).
 */
export function formatAttachments(rows: readonly AttachmentRow[]): Attachment[] {
  return rows
    .filter((row) => row.filename?.trim())
    .map((row) => ({
      id: row.id,
      filename: row.filename,
      contentType: row.content_type,
      sizeLabel: formatFileSize(row.size_bytes),
      createdAt: row.created_at,
      uploadedByName: row.uploaded_by_user?.full_name?.trim() || UNKNOWN_UPLOADER,
      textExtractionStatus: row.text_extraction_status,
      extractedText: row.extracted_text,
      extractedPageCount: row.extracted_page_count,
      extractedTextTruncated: row.extracted_text_truncated,
    }))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

// ---------------------------------------------------------------------------
// F081 — upload: shared limits, client-side pre-check, storage path, and
// Storage-error-to-message mapping.
// ---------------------------------------------------------------------------

/**
 * Provisional default (25 MB), not a signed-off policy. PRD §14 names
 * "Attachment size/type limits" as its own open question owned by
 * "Security + email epic owner", separate from this ticket's own blocker
 * ("File storage provider"). Picked so the upload flow has *a* real, enforced
 * ceiling rather than none; centralised here — and in the bucket's
 * `file_size_limit` in the migration — so both sides change together.
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Office documents + common images — the shapes a CAM actually attaches
 * (signed agreements, spreadsheets, screenshots), excluding anything
 * executable or archived. Same provisional-default caveat as the size limit
 * above; kept in sync by hand with the bucket's `allowed_mime_types`.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const ALLOWED_TYPES_DESCRIPTION =
  "PDF, Word, Excel, PowerPoint, text, CSV, or image file";

/**
 * AC3 (fast path): catches the common cases — too big, obviously wrong type —
 * before a byte is uploaded. Not the enforcement boundary; the bucket's own
 * `file_size_limit`/`allowed_mime_types` (set in the migration) is, since this
 * check runs in the browser and a caller going around the UI skips it entirely.
 *
 * `type` is checked only when the browser supplied one: some OS/browser
 * combinations leave `file.type` blank for a file they don't recognise, and
 * treating "unknown" as "rejected" would block real, permitted files for a
 * reason the CAM can't see or fix. The bucket-level check still applies to
 * those uploads.
 */
export function validateAttachmentFile(file: {
  size: number;
  type: string;
  name: string;
}): string | null {
  if (!file.name.trim()) return "Choose a file to upload.";
  if (file.size <= 0) return "This file is empty.";
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return `This file is too large. The maximum size is ${formatFileSize(MAX_ATTACHMENT_SIZE_BYTES)}.`;
  }
  if (file.type && !ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type)) {
    return `This file type is not supported. Upload a ${ALLOWED_TYPES_DESCRIPTION}.`;
  }
  return null;
}

/**
 * Storage object names reject a handful of characters and this keeps the path
 * short; the original name is never lost — it's stored separately in
 * `attachments.filename` and is what the profile actually displays.
 */
export function sanitizeAttachmentFilename(filename: string): string {
  const cleaned = filename.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 150);
  // A run of nothing but disallowed characters (e.g. "???") collapses to a
  // single "_", which is non-empty but not a usable name — the fallback needs
  // at least one real alphanumeric character to have survived, not just any
  // output from the replace above.
  return /[a-zA-Z0-9]/.test(cleaned) ? cleaned : "file";
}

/**
 * organisation_id leads (migration's path scheme) so record_attachment can
 * check the path matches the organisation being attached to without a second
 * lookup; a random id before the filename keeps two uploads of "invoice.pdf"
 * to the same client from colliding in Storage.
 */
export function buildAttachmentStoragePath(
  organisationId: string,
  filename: string,
  uploadId: string,
): string {
  return `${organisationId}/${uploadId}-${sanitizeAttachmentFilename(filename)}`;
}

/**
 * Maps a Supabase Storage upload error onto something safe and specific to
 * show a CAM (AC3). Based on the documented Storage error shapes (statusCode
 * '413' payload-too-large, '415'/'400' unsupported mime type) — not verified
 * against a live bucket in this environment, so the message-substring checks
 * are a defensive fallback alongside the statusCode checks, not the primary
 * mechanism.
 */
export function attachmentUploadFailureMessage(
  error: { message?: string; statusCode?: string } | null | undefined,
): string {
  const message = error?.message?.toLowerCase() ?? "";

  if (
    error?.statusCode === "413" ||
    message.includes("exceeded the maximum allowed size") ||
    message.includes("too large")
  ) {
    return `This file is too large. The maximum size is ${formatFileSize(MAX_ATTACHMENT_SIZE_BYTES)}.`;
  }
  if (
    error?.statusCode === "415" ||
    message.includes("mime type") ||
    message.includes("not supported")
  ) {
    return `This file type is not supported. Upload a ${ALLOWED_TYPES_DESCRIPTION}.`;
  }
  if (error?.statusCode === "409" || message.includes("already exists")) {
    return "That file could not be uploaded — try again.";
  }
  return "The file could not be uploaded. Refresh and try again.";
}

export type RpcFailure = { status: number; error: string };

const GENERIC_RECORD_FAILURE = "The attachment could not be saved. Refresh and try again.";

/**
 * Maps a Postgres error from record_attachment onto something safe to show a
 * user. Same shape as ownershipRequestRpcFailure/clientEditSuggestionRpcFailure:
 * every errcode below is one the RPC raises deliberately with a message
 * written to be read by a CAM; anything else gets the generic string.
 */
export function attachmentRpcFailure(error: { code?: string; message?: string }): RpcFailure {
  if (!error.message?.trim()) {
    return { status: 500, error: GENERIC_RECORD_FAILURE };
  }
  switch (error.code) {
    case "42501":
      return { status: 403, error: error.message };
    case "22023":
    case "23514":
      return { status: 400, error: error.message };
    case "23505":
      return { status: 409, error: error.message };
    case "P0002":
      return { status: 404, error: error.message };
    default:
      return { status: 500, error: GENERIC_RECORD_FAILURE };
  }
}
