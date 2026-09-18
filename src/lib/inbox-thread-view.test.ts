import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { attachmentFileTypeFromFilename } from "./inbox-thread-view.ts";

describe("attachmentFileTypeFromFilename", () => {
  it("maps exact family members", () => {
    assert.equal(attachmentFileTypeFromFilename("deck.pdf"), "pdf");
    assert.equal(attachmentFileTypeFromFilename("notes.docx"), "docx");
    assert.equal(attachmentFileTypeFromFilename("budget.xlsx"), "xlsx");
    assert.equal(attachmentFileTypeFromFilename("slides.pptx"), "pptx");
    assert.equal(attachmentFileTypeFromFilename("photo.png"), "png");
  });

  it("collapses format variants into families", () => {
    assert.equal(attachmentFileTypeFromFilename("legacy.doc"), "docx");
    assert.equal(attachmentFileTypeFromFilename("legacy.xls"), "xlsx");
    assert.equal(attachmentFileTypeFromFilename("export.csv"), "xlsx");
    assert.equal(attachmentFileTypeFromFilename("legacy.ppt"), "pptx");
    assert.equal(attachmentFileTypeFromFilename("photo.JPG"), "png");
    assert.equal(attachmentFileTypeFromFilename("shot.jpeg"), "png");
  });

  it("is case- and whitespace-tolerant", () => {
    assert.equal(attachmentFileTypeFromFilename("Deck.PDF"), "pdf");
    assert.equal(attachmentFileTypeFromFilename("  deck.pdf  "), "pdf");
  });

  it("falls back to the generic document family", () => {
    assert.equal(attachmentFileTypeFromFilename("notes.txt"), "docx");
    assert.equal(attachmentFileTypeFromFilename("README"), "docx");
    assert.equal(attachmentFileTypeFromFilename("archive.tar.gz"), "docx");
  });
});
