import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_NOTE_LENGTH,
  bulkNoteInsertFailure,
  bulkNoteSummary,
  commentProblemMessage,
  prepareComment,
} from "./bulk-note.ts";

describe("prepareComment", () => {
  it("trims surrounding whitespace off what gets stored", () => {
    assert.deepEqual(prepareComment("  spoke to the CEO on Tuesday  "), {
      ok: true,
      content: "spoke to the CEO on Tuesday",
    });
  });

  it("rejects a comment that is only whitespace, as the notes_content_not_blank check would", () => {
    assert.deepEqual(prepareComment("   \n\t "), { ok: false, problem: "empty" });
  });

  it("rejects an empty comment", () => {
    assert.deepEqual(prepareComment(""), { ok: false, problem: "empty" });
  });

  it("accepts a comment exactly at the length ceiling", () => {
    const content = "x".repeat(MAX_NOTE_LENGTH);
    assert.deepEqual(prepareComment(content), { ok: true, content });
  });

  it("rejects a comment one character over the ceiling", () => {
    assert.deepEqual(prepareComment("x".repeat(MAX_NOTE_LENGTH + 1)), {
      ok: false,
      problem: "too_long",
    });
  });

  it("measures length after trimming, so trailing whitespace cannot push a valid comment over", () => {
    assert.deepEqual(prepareComment(`${"x".repeat(MAX_NOTE_LENGTH)}      `), {
      ok: true,
      content: "x".repeat(MAX_NOTE_LENGTH),
    });
  });
});

describe("commentProblemMessage", () => {
  it("tells the CAM to write something when the comment is empty", () => {
    assert.equal(
      commentProblemMessage("empty"),
      "Write a comment before adding it to the selected clients.",
    );
  });

  it("names the limit when the comment is too long", () => {
    assert.match(commentProblemMessage("too_long"), new RegExp(String(MAX_NOTE_LENGTH)));
  });
});

describe("bulkNoteInsertFailure", () => {
  it("maps an RLS refusal to 403 without repeating the policy name", () => {
    const failure = bulkNoteInsertFailure({
      code: "42501",
      message: 'new row violates row-level security policy for table "notes"',
    });
    assert.equal(failure.status, 403);
    assert.equal(failure.error, "Your account cannot add comments to clients.");
    assert.doesNotMatch(failure.error, /policy|notes|row-level/i);
  });

  it("maps a foreign key violation to 404 and says nothing was written", () => {
    const failure = bulkNoteInsertFailure({
      code: "23503",
      message: 'insert or update on table "notes" violates foreign key constraint',
    });
    assert.equal(failure.status, 404);
    assert.match(failure.error, /no longer exists/i);
    assert.match(failure.error, /No comment was added/i);
  });

  it("maps the blank-content check to the same sentence the client-side validation gives", () => {
    assert.deepEqual(bulkNoteInsertFailure({ code: "23514", message: "notes_content_not_blank" }), {
      status: 400,
      error: commentProblemMessage("empty"),
    });
  });

  it("hides anything it does not recognise behind a generic message", () => {
    const failure = bulkNoteInsertFailure({
      code: "XX000",
      message: "PANIC: could not write to file pg_wal/000000010000000000000001",
    });
    assert.equal(failure.status, 500);
    assert.doesNotMatch(failure.error, /pg_wal|PANIC/);
  });

  it("hides an error that carries no code at all", () => {
    assert.equal(bulkNoteInsertFailure({}).status, 500);
  });
});

describe("bulkNoteSummary", () => {
  it("reports the count when every selected client received the comment", () => {
    assert.equal(
      bulkNoteSummary({ requested: 12, created: 12 }),
      "Comment added to 12 clients.",
    );
  });

  it("does not pluralise a single client", () => {
    assert.equal(bulkNoteSummary({ requested: 1, created: 1 }), "Comment added to 1 client.");
  });

  it("says both numbers rather than claiming success when fewer rows came back than were asked for", () => {
    const summary = bulkNoteSummary({ requested: 10, created: 7 });
    assert.match(summary, /7 of 10/);
    assert.match(summary, /Refresh/);
  });
});
