import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNKNOWN_AUTHOR,
  buildDisplayNote,
  buildNoteList,
  canEditNote,
  orderNotesNewestFirst,
  type NoteRow,
} from "./note-history.ts";

function note(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: "note-1",
    content: "Spoke with the treasurer, they're keen but need trustee sign-off.",
    created_at: "2026-08-01T09:00:00Z",
    updated_at: null,
    author_id: "user-1",
    author: { full_name: "Ada Lovelace" },
    ...overrides,
  };
}

describe("orderNotesNewestFirst", () => {
  it("orders by creation time, newest first (AC3)", () => {
    const rows = [
      note({ id: "old", created_at: "2026-07-01T00:00:00Z" }),
      note({ id: "new", created_at: "2026-08-01T00:00:00Z" }),
      note({ id: "mid", created_at: "2026-07-15T00:00:00Z" }),
    ];

    const ordered = orderNotesNewestFirst(rows);

    assert.deepEqual(ordered.map((n) => n.id), ["new", "mid", "old"]);
  });

  it("returns an empty list for a client with no notes", () => {
    assert.deepEqual(orderNotesNewestFirst([]), []);
  });

  it("does not mutate the input array", () => {
    const rows = [note({ id: "a", created_at: "2026-07-01T00:00:00Z" }), note({ id: "b", created_at: "2026-08-01T00:00:00Z" })];
    const original = [...rows];

    orderNotesNewestFirst(rows);

    assert.deepEqual(rows, original);
  });
});

describe("buildDisplayNote", () => {
  it("shows the author's name and creation date for an ordinary note", () => {
    const display = buildDisplayNote(note());
    assert.equal(display.authorName, "Ada Lovelace");
    assert.equal(display.createdAt, "2026-08-01T09:00:00Z");
    assert.equal(display.edited, false);
  });

  it("falls back to a generic label when the author's account no longer exists", () => {
    const display = buildDisplayNote(note({ author_id: null, author: null }));
    assert.equal(display.authorName, UNKNOWN_AUTHOR);
  });

  it("falls back to the generic label when the embed is missing but author_id is still set", () => {
    const display = buildDisplayNote(note({ author: null }));
    assert.equal(display.authorName, UNKNOWN_AUTHOR);
  });

  it("marks a note edited once it has an updated_at", () => {
    const display = buildDisplayNote(note({ updated_at: "2026-08-02T00:00:00Z" }));
    assert.equal(display.edited, true);
  });
});

describe("canEditNote", () => {
  it("lets the author edit their own note", () => {
    assert.equal(
      canEditNote(note({ author_id: "cam-1" }), { id: "cam-1", role: "cam" }),
      true,
    );
  });

  it("refuses a different CAM (F073 AC1)", () => {
    assert.equal(
      canEditNote(note({ author_id: "cam-1" }), { id: "cam-2", role: "cam" }),
      false,
    );
  });

  it("lets an admin edit any note", () => {
    assert.equal(
      canEditNote(note({ author_id: "cam-1" }), { id: "admin-1", role: "admin" }),
      true,
    );
  });

  it("refuses a viewer even for a note with no author left", () => {
    assert.equal(
      canEditNote(note({ author_id: null }), { id: "viewer-1", role: "viewer" }),
      false,
    );
  });
});

describe("buildNoteList", () => {
  it("orders newest first and marks which notes the actor may edit", () => {
    const rows = [
      note({ id: "old", author_id: "cam-1", created_at: "2026-07-01T00:00:00Z" }),
      note({ id: "new", author_id: "cam-2", created_at: "2026-08-01T00:00:00Z" }),
    ];

    const list = buildNoteList(rows, { id: "cam-1", role: "cam" });

    assert.deepEqual(list.map((n) => n.id), ["new", "old"]);
    assert.equal(list.find((n) => n.id === "old")?.canEdit, true);
    assert.equal(list.find((n) => n.id === "new")?.canEdit, false);
  });
});
