/**
 * F080 — View Client Attachments.
 *
 * Formatting logic behind the client profile's attachment list, kept out of
 * the page so it can be tested without a database (same split as
 * @/lib/source-tracking and @/lib/note-history).
 *
 * There is no write path yet — see 20260823090000_create_attachments.sql's
 * header. Every function here only ever formats what F081 will eventually let
 * someone create.
 */

export type AttachmentRow = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  uploaded_by_user: { full_name: string | null } | null;
};

export type Attachment = {
  id: string;
  filename: string;
  contentType: string | null;
  sizeLabel: string | null;
  createdAt: string;
  uploadedByName: string;
};

const UNKNOWN_UPLOADER = "A former team member";

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
    }))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
