import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SAVED_VIEWS,
  MAX_VIEW_NAME_LENGTH,
  type SavedViewFilters,
} from "./saved-view-filters.ts";
import { deleteView, saveView, type SavedViewDb } from "./saved-view-writes.ts";

type InsertCall = { userId: string; name: string; filters: SavedViewFilters };
type DeleteCall = { userId: string; id: string };

function fakeDb(
  responses: {
    count?: number | null;
    countError?: unknown;
    insert?: { code?: string } | null;
    delete?: unknown;
  } = {},
): SavedViewDb & { inserts: InsertCall[]; deletes: DeleteCall[] } {
  const inserts: InsertCall[] = [];
  const deletes: DeleteCall[] = [];
  return {
    inserts,
    deletes,
    async countViews() {
      return { count: responses.count ?? 0, error: responses.countError ?? null };
    },
    async insertView(userId, name, filters) {
      inserts.push({ userId, name, filters });
      return { error: responses.insert ?? null };
    },
    async deleteView(userId, id) {
      deletes.push({ userId, id });
      return { error: responses.delete ?? null };
    },
  };
}

describe("saveView", () => {
  it("saves the filter combination under the given name", async () => {
    const db = fakeDb();
    const outcome = await saveView(db, "user-1", " Leeds prospects ", {
      city: ["Leeds"],
      status: ["Meeting set"],
    });

    assert.deepEqual(outcome, { ok: true, name: "Leeds prospects" });
    assert.deepEqual(db.inserts, [
      {
        userId: "user-1",
        name: "Leeds prospects",
        filters: { city: ["Leeds"], status: ["Meeting set"] },
      },
    ]);
  });

  it("stores only the params a view is made of", async () => {
    const db = fakeDb();
    await saveView(db, "user-1", "Everything", {
      q: "oxfam",
      page: "4",
      stage: "converted",
      name: "Everything",
      injected: "value",
    });

    assert.deepEqual(db.inserts[0].filters, { q: "oxfam" });
  });

  it("saves an unfiltered view as an empty combination", async () => {
    const db = fakeDb();
    const outcome = await saveView(db, "user-1", "Everything", {});

    assert.equal(outcome.ok, true);
    assert.deepEqual(db.inserts[0].filters, {});
  });

  it("refuses a blank name without touching the database", async () => {
    const db = fakeDb();

    assert.deepEqual(await saveView(db, "user-1", "   ", { q: "oxfam" }), {
      ok: false,
      reason: "invalid_name",
    });
    assert.equal(db.inserts.length, 0);
  });

  it("refuses a name past the column's cap without touching the database", async () => {
    const db = fakeDb();
    const outcome = await saveView(db, "user-1", "x".repeat(MAX_VIEW_NAME_LENGTH + 1), {});

    assert.deepEqual(outcome, { ok: false, reason: "invalid_name" });
    assert.equal(db.inserts.length, 0);
  });

  it("reports a name the CAM has already used", async () => {
    const db = fakeDb({ insert: { code: "23505" } });

    assert.deepEqual(await saveView(db, "user-1", "Leeds prospects", {}), {
      ok: false,
      reason: "duplicate_name",
    });
  });

  it("reads a check violation as a name problem, not a crash", async () => {
    const db = fakeDb({ insert: { code: "23514" } });

    assert.deepEqual(await saveView(db, "user-1", "Leeds", {}), {
      ok: false,
      reason: "invalid_name",
    });
  });

  it("refuses to save past the per-user cap", async () => {
    const db = fakeDb({ count: MAX_SAVED_VIEWS });

    assert.deepEqual(await saveView(db, "user-1", "One more", {}), {
      ok: false,
      reason: "limit_reached",
    });
    assert.equal(db.inserts.length, 0);
  });

  it("still saves when the count read fails", async () => {
    // The cap is a courtesy, not a security control: losing it is a smaller harm
    // than refusing a legitimate view because a secondary read went wrong.
    const db = fakeDb({ count: null, countError: { message: "boom" } });

    assert.equal((await saveView(db, "user-1", "Leeds", {})).ok, true);
    assert.equal(db.inserts.length, 1);
  });

  it("passes an unexpected write failure back with the error", async () => {
    const db = fakeDb({ insert: { code: "08006" } });
    const outcome = await saveView(db, "user-1", "Leeds", {});

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "write_failed");
  });
});

describe("deleteView", () => {
  it("deletes the view, scoped to the caller", async () => {
    const db = fakeDb();

    assert.deepEqual(await deleteView(db, "user-1", "view-1"), { ok: true });
    assert.deepEqual(db.deletes, [{ userId: "user-1", id: "view-1" }]);
  });

  it("refuses a missing id without touching the database", async () => {
    const db = fakeDb();

    assert.deepEqual(await deleteView(db, "user-1", undefined), {
      ok: false,
      reason: "missing_id",
    });
    assert.deepEqual(await deleteView(db, "user-1", "  "), {
      ok: false,
      reason: "missing_id",
    });
    assert.equal(db.deletes.length, 0);
  });

  // Someone else's view id removes nothing, because the statement is scoped to the
  // caller — and "no such view" must read the same as "not your view" (§4).
  it("treats deleting nothing as success", async () => {
    const db = fakeDb();

    assert.deepEqual(await deleteView(db, "user-1", "someone-elses-view"), { ok: true });
  });

  it("reports a failed delete", async () => {
    const db = fakeDb({ delete: { message: "boom" } });
    const outcome = await deleteView(db, "user-1", "view-1");

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "write_failed");
  });
});
