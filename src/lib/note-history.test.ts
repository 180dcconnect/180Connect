import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNKNOWN_AUTHOR,
  buildDisplayNote,
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
