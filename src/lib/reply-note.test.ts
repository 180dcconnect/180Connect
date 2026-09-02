import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReplyNoteContent } from "./reply-note.ts";

describe("buildReplyNoteContent (F136)", () => {
  it("associates a normal note with one exact reply", () => {
    const content = buildReplyNoteContent({
      note: "Confirm the pricing answer with the project lead.",
      replyId: "00000000-0000-4000-a136-000000000001",
      replyBody: "Thanks. What would a typical project cost?",
      receivedAt: "2026-08-27T10:30:00Z",
    });

    assert.match(content, /reference 00000000-0000-4000-a136-000000000001/);
    assert.match(content, /Client wrote: “Thanks\. What would a typical project cost\?”/);
    assert.match(content, /Confirm the pricing answer with the project lead\./);
  });

  it("normalises and bounds a long reply quote without changing the CAM's note", () => {
    const note = "  Keep this important note.  ";
    const content = buildReplyNoteContent({
      note,
      replyId: "reply-1",
      replyBody: `First line\n\n${"x".repeat(600)}`,
      receivedAt: "2026-08-27T10:30:00Z",
    });

    assert.match(content, /Client wrote: “First line x+/);
    assert.match(content, /…”/);
    assert.ok(content.endsWith("Keep this important note."));
  });
});
