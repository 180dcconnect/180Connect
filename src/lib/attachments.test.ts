import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAttachments, formatFileSize, type AttachmentRow } from "./attachments.ts";

function row(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: "attachment-1",
    filename: "signed-agreement.pdf",
    content_type: "application/pdf",
    size_bytes: 245_760,
    created_at: "2026-08-01T10:00:00Z",
    uploaded_by_user: { full_name: "Alex CAM" },
    ...overrides,
  };
}

describe("formatFileSize", () => {
  it("shows bytes below 1 KB with no decimal", () => {
    assert.equal(formatFileSize(512), "512 B");
    assert.equal(formatFileSize(0), "0 B");
  });

  it("shows KB/MB/GB with one decimal place", () => {
    assert.equal(formatFileSize(245_760), "240.0 KB");
    assert.equal(formatFileSize(1_572_864), "1.5 MB");
    assert.equal(formatFileSize(2 * 1024 ** 3), "2.0 GB");
  });

  it("returns null for missing or invalid sizes rather than throwing", () => {
    assert.equal(formatFileSize(null), null);
    assert.equal(formatFileSize(undefined), null);
    assert.equal(formatFileSize(-5), null);
    assert.equal(formatFileSize(Number.NaN), null);
  });
});

describe("formatAttachments", () => {
  it("carries filename, size and uploader through (AC1/AC2)", () => {
    const [attachment] = formatAttachments([row()]);
    assert.equal(attachment?.filename, "signed-agreement.pdf");
    assert.equal(attachment?.sizeLabel, "240.0 KB");
    assert.equal(attachment?.uploadedByName, "Alex CAM");
  });

  it("returns an empty list for a client with no attachments (AC3)", () => {
    assert.deepEqual(formatAttachments([]), []);
  });

  it("handles missing size/content-type gracefully (client with missing data)", () => {
    const [attachment] = formatAttachments([
      row({ size_bytes: null, content_type: null }),
    ]);
    assert.equal(attachment?.sizeLabel, null);
    assert.equal(attachment?.contentType, null);
  });

  it("falls back when the uploader can no longer be identified", () => {
    const [attachment] = formatAttachments([row({ uploaded_by_user: null })]);
    assert.equal(attachment?.uploadedByName, "A former team member");
  });

  it("drops a row with a blank filename rather than showing an empty link", () => {
    assert.deepEqual(formatAttachments([row({ filename: "   " })]), []);
  });

  it("orders newest first", () => {
    const attachments = formatAttachments([
      row({ id: "older", created_at: "2026-08-01T10:00:00Z" }),
      row({ id: "newer", created_at: "2026-08-05T10:00:00Z" }),
    ]);
    assert.deepEqual(attachments.map((a) => a.id), ["newer", "older"]);
  });
});
