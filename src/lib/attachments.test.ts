import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ATTACHMENTS_PER_DRAFT,
  MAX_COMBINED_ATTACHMENT_SIZE_BYTES,
  attachmentRpcFailure,
  attachmentUploadFailureMessage,
  buildAttachmentStoragePath,
  formatAttachments,
  formatFileSize,
  sanitizeAttachmentFilename,
  validateAttachmentFile,
  validateDraftAttachmentSet,
  type AttachmentRow,
} from "./attachments.ts";

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
  it("carries filename, size and uploader through (AC1/AC2 of F080)", () => {
    const [attachment] = formatAttachments([row()]);
    assert.equal(attachment?.filename, "signed-agreement.pdf");
    assert.equal(attachment?.sizeLabel, "240.0 KB");
    assert.equal(attachment?.uploadedByName, "Alex CAM");
  });

  it("returns an empty list for a client with no attachments", () => {
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

describe("validateAttachmentFile (F081 AC3)", () => {
  it("accepts a file within the size limit and an allowed type", () => {
    assert.equal(
      validateAttachmentFile({ size: 1024, type: "application/pdf", name: "a.pdf" }),
      null,
    );
  });

  it("rejects a file with no name", () => {
    assert.match(
      validateAttachmentFile({ size: 1024, type: "application/pdf", name: "  " }) ?? "",
      /choose a file/i,
    );
  });

  it("rejects an empty file", () => {
    assert.match(
      validateAttachmentFile({ size: 0, type: "application/pdf", name: "a.pdf" }) ?? "",
      /empty/i,
    );
  });

  it("rejects a file over the size limit with a specific message naming the limit", () => {
    const message = validateAttachmentFile({
      size: MAX_ATTACHMENT_SIZE_BYTES + 1,
      type: "application/pdf",
      name: "a.pdf",
    });
    assert.match(message ?? "", /too large/i);
    assert.match(message ?? "", /25\.0 MB/);
  });

  it("rejects a file at exactly the size limit boundary as allowed", () => {
    assert.equal(
      validateAttachmentFile({ size: MAX_ATTACHMENT_SIZE_BYTES, type: "application/pdf", name: "a.pdf" }),
      null,
    );
  });

  it("rejects an unsupported mime type with a specific message", () => {
    const message = validateAttachmentFile({
      size: 1024,
      type: "application/x-msdownload",
      name: "a.exe",
    });
    assert.match(message ?? "", /not supported/i);
  });

  it("does not reject a file the browser could not identify a type for", () => {
    assert.equal(
      validateAttachmentFile({ size: 1024, type: "", name: "a.unknown" }),
      null,
    );
  });

  it("accepts every type in the shared allowlist", () => {
    for (const type of ALLOWED_ATTACHMENT_MIME_TYPES) {
      assert.equal(validateAttachmentFile({ size: 1024, type, name: "f" }), null);
    }
  });
});

describe("sanitizeAttachmentFilename", () => {
  it("keeps a simple safe filename as-is", () => {
    assert.equal(sanitizeAttachmentFilename("invoice.pdf"), "invoice.pdf");
  });

  it("replaces unsafe characters", () => {
    assert.equal(sanitizeAttachmentFilename("my report (final)!.pdf"), "my_report_final_.pdf");
  });

  it("falls back to a default when nothing usable remains", () => {
    assert.equal(sanitizeAttachmentFilename("   "), "file");
    assert.equal(sanitizeAttachmentFilename("???"), "file");
  });

  it("caps an unreasonably long filename", () => {
    const long = "a".repeat(500) + ".pdf";
    assert.ok(sanitizeAttachmentFilename(long).length <= 150);
  });
});

describe("buildAttachmentStoragePath", () => {
  it("leads with the organisation id and includes the sanitized filename", () => {
    const path = buildAttachmentStoragePath(
      "11111111-1111-4111-8111-111111111111",
      "invoice.pdf",
      "upload-1",
    );
    assert.equal(path, "11111111-1111-4111-8111-111111111111/upload-1-invoice.pdf");
  });
});

describe("attachmentUploadFailureMessage (F081 AC3)", () => {
  it("maps a 413 to a size-specific message", () => {
    assert.match(
      attachmentUploadFailureMessage({ statusCode: "413", message: "Payload too large" }),
      /too large/i,
    );
  });

  it("maps a size message without a statusCode the same way", () => {
    assert.match(
      attachmentUploadFailureMessage({ message: "The object exceeded the maximum allowed size" }),
      /too large/i,
    );
  });

  it("maps a 415 to a type-specific message", () => {
    assert.match(
      attachmentUploadFailureMessage({ statusCode: "415", message: "mime type not supported" }),
      /not supported/i,
    );
  });

  it("falls back to a generic message for anything unrecognised", () => {
    assert.equal(
      attachmentUploadFailureMessage({ statusCode: "500", message: "internal error" }),
      "The file could not be uploaded. Refresh and try again.",
    );
  });

  it("handles a null/undefined error without throwing", () => {
    assert.equal(
      attachmentUploadFailureMessage(null),
      "The file could not be uploaded. Refresh and try again.",
    );
    assert.equal(
      attachmentUploadFailureMessage(undefined),
      "The file could not be uploaded. Refresh and try again.",
    );
  });
});

describe("attachmentRpcFailure", () => {
  it("passes through a deliberate permission refusal", () => {
    assert.deepEqual(
      attachmentRpcFailure({ code: "42501", message: "only a CAM or admin can attach a file" }),
      { status: 403, error: "only a CAM or admin can attach a file" },
    );
  });

  it("maps a blank filename or path mismatch to 400", () => {
    assert.equal(attachmentRpcFailure({ code: "23514", message: "required" }).status, 400);
    assert.equal(attachmentRpcFailure({ code: "22023", message: "path mismatch" }).status, 400);
  });

  it("maps a duplicate storage path to 409", () => {
    assert.equal(attachmentRpcFailure({ code: "23505", message: "duplicate" }).status, 409);
  });

  it("maps a missing organisation or storage object to 404", () => {
    assert.equal(attachmentRpcFailure({ code: "P0002", message: "not found" }).status, 404);
  });

  it("hides an unexpected error behind a generic message", () => {
    const failure = attachmentRpcFailure({
      code: "42P01",
      message: 'relation "public.attachments" does not exist',
    });
    assert.equal(failure.status, 500);
    assert.ok(!failure.error.includes("relation"));
  });

  it("hides a message-less error too", () => {
    assert.equal(attachmentRpcFailure({ code: "42501", message: "  " }).status, 500);
  });
});

describe("validateDraftAttachmentSet (F217)", () => {
  it("allows a first attachment on an empty draft", () => {
    assert.equal(
      validateDraftAttachmentSet({ count: 0, totalSizeBytes: 0 }, { sizeBytes: 1024 }),
      null,
    );
  });

  it(`refuses an ${MAX_ATTACHMENTS_PER_DRAFT + 1}th attachment`, () => {
    const message = validateDraftAttachmentSet(
      { count: MAX_ATTACHMENTS_PER_DRAFT, totalSizeBytes: 0 },
      { sizeBytes: 1 },
    );
    assert.match(message ?? "", new RegExp(`${MAX_ATTACHMENTS_PER_DRAFT}`));
  });

  it("allows exactly reaching the combined size cap", () => {
    assert.equal(
      validateDraftAttachmentSet(
        { count: 0, totalSizeBytes: 0 },
        { sizeBytes: MAX_COMBINED_ATTACHMENT_SIZE_BYTES },
      ),
      null,
    );
  });

  it("refuses a file that would push the combined total over the cap", () => {
    const message = validateDraftAttachmentSet(
      { count: 1, totalSizeBytes: MAX_COMBINED_ATTACHMENT_SIZE_BYTES - 100 },
      { sizeBytes: 101 },
    );
    assert.match(message ?? "", /too large to send together/);
  });

  it("checks the count cap before the size cap when both would fail", () => {
    // The count message is the more actionable one when a draft is already
    // both full and heavy — no point telling a CAM to shrink files they
    // cannot add a 11th of anyway.
    const message = validateDraftAttachmentSet(
      { count: MAX_ATTACHMENTS_PER_DRAFT, totalSizeBytes: MAX_COMBINED_ATTACHMENT_SIZE_BYTES },
      { sizeBytes: 1 },
    );
    assert.match(message ?? "", new RegExp(`${MAX_ATTACHMENTS_PER_DRAFT}`));
  });
});
