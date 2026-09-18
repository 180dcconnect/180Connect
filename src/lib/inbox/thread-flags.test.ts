import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  applyThreadFlags,
  emptyThreadFlags,
  getThreadFlagsSnapshot,
  resetThreadFlagsStoreForTests,
  seedThreadFlags,
  threadFlagsFromRows,
  updateThreadFlags,
  type InboxThreadStateRow,
} from "./thread-flags.ts";

type Row = { id: string; isStarred: boolean; isRead: boolean; folder: string };

const rows: Row[] = [
  { id: "a", isStarred: false, isRead: false, folder: "inbox" },
  { id: "b", isStarred: false, isRead: true, folder: "inbox" },
];

describe("applyThreadFlags", () => {
  it("leaves threads untouched when the viewer has no flags", () => {
    const result = applyThreadFlags(rows, emptyThreadFlags());
    assert.deepEqual(result, rows);
    // Referentially identical, so the memo downstream does not re-run.
    assert.equal(result[0], rows[0]);
  });

  it("stars, reads and trashes by id", () => {
    const flags = emptyThreadFlags();
    flags.starred.add("a");
    flags.read.add("a");
    flags.trashed.add("b");
    const [a, b] = applyThreadFlags(rows, flags);
    assert.equal(a.isStarred, true);
    assert.equal(a.isRead, true);
    assert.equal(b.folder, "trash");
  });

  it("keeps a deliberately unread thread unread", () => {
    // The server derives `isRead` from whether the newest event is an
    // unanswered reply, so without this the next load would silently undo
    // "mark as unread".
    const flags = emptyThreadFlags();
    flags.unread.add("b");
    assert.equal(applyThreadFlags(rows, flags)[1].isRead, false);
  });

  it("never unstars something the server already starred", () => {
    const server: Row[] = [{ id: "a", isStarred: true, isRead: true, folder: "inbox" }];
    assert.equal(applyThreadFlags(server, emptyThreadFlags())[0].isStarred, true);
  });

  it("ignores flags for threads that are not in the list", () => {
    const flags = emptyThreadFlags();
    flags.starred.add("gone");
    assert.deepEqual(applyThreadFlags(rows, flags), rows);
  });
});

describe("threadFlagsFromRows", () => {
  it("folds stored rows into the four override sets", () => {
    const rows: InboxThreadStateRow[] = [
      { organisation_id: "a", is_starred: true, read_state: "read", is_trashed: false },
      { organisation_id: "b", is_starred: false, read_state: "unread", is_trashed: false },
      { organisation_id: "c", is_starred: false, read_state: null, is_trashed: true },
    ];
    const flags = threadFlagsFromRows(rows);
    assert.deepEqual([...flags.starred], ["a"]);
    assert.deepEqual([...flags.read], ["a"]);
    assert.deepEqual([...flags.unread], ["b"]);
    assert.deepEqual([...flags.trashed], ["c"]);
  });

  it("treats a row carrying nothing as no overrides", () => {
    const flags = threadFlagsFromRows([
      { organisation_id: "a", is_starred: false, read_state: null, is_trashed: false },
    ]);
    assert.deepEqual(flags, emptyThreadFlags());
  });
});

describe("seedThreadFlags", () => {
  it("adopts the server's rows, and re-seeding the same array is a no-op", () => {
    resetThreadFlagsStoreForTests();
    const rows: InboxThreadStateRow[] = [
      { organisation_id: "a", is_starred: true, read_state: null, is_trashed: false },
    ];
    seedThreadFlags(rows);
    const first = getThreadFlagsSnapshot();
    assert.deepEqual([...first.starred], ["a"]);

    // Identity-compared, so calling it every render must not replace the
    // snapshot — a new object each time would loop useSyncExternalStore.
    seedThreadFlags(rows);
    assert.equal(getThreadFlagsSnapshot(), first);
  });

  it("replaces the snapshot when the server sends a genuinely new array", () => {
    resetThreadFlagsStoreForTests();
    seedThreadFlags([{ organisation_id: "a", is_starred: true, read_state: null, is_trashed: false }]);
    seedThreadFlags([{ organisation_id: "b", is_starred: true, read_state: null, is_trashed: false }]);
    assert.deepEqual([...getThreadFlagsSnapshot().starred], ["b"]);
  });
});

describe("updateThreadFlags", () => {
  const star = (id: string) => (previous: ReturnType<typeof emptyThreadFlags>) => ({
    ...previous,
    starred: new Set([...previous.starred, id]),
  });

  it("applies the change before the write resolves, and keeps it on success", async () => {
    resetThreadFlagsStoreForTests();
    let resolved = false;
    const pending = updateThreadFlags(star("a"), async () => {
      // Already visible: the star must land on the row the instant it is
      // clicked, not a round trip later.
      assert.deepEqual([...getThreadFlagsSnapshot().starred], ["a"]);
      resolved = true;
      return { ok: true };
    });
    await pending;
    assert.equal(resolved, true);
    assert.deepEqual([...getThreadFlagsSnapshot().starred], ["a"]);
  });

  it("rolls back and reports when the write is refused", async () => {
    resetThreadFlagsStoreForTests();
    const messages: string[] = [];
    await updateThreadFlags(
      star("a"),
      async () => ({ ok: false, message: "nope" }),
      (message) => messages.push(message),
    );
    assert.deepEqual([...getThreadFlagsSnapshot().starred], []);
    assert.deepEqual(messages, ["nope"]);
  });

  it("rolls back when the write throws", async () => {
    resetThreadFlagsStoreForTests();
    const messages: string[] = [];
    await updateThreadFlags(
      star("a"),
      async () => {
        throw new Error("network");
      },
      (message) => messages.push(message),
    );
    assert.deepEqual([...getThreadFlagsSnapshot().starred], []);
    assert.equal(messages.length, 1);
  });
});
