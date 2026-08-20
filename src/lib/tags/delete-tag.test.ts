import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deleteTagCore, type TagDeleteClient } from "./delete-tag-core.ts";

function fakeClient(overrides: Partial<TagDeleteClient> = {}) {
  const deleteCalls: string[] = [];
  const client: TagDeleteClient = {
    async countAssignments() {
      return 0;
    },
    async deleteTag(tagId) {
      deleteCalls.push(tagId);
      return { ok: true };
    },
    ...overrides,
  };
  return { client, deleteCalls };
}

describe("deleteTagCore — successful delete, unused tag", () => {
  it("deletes a tag with zero assignments", async () => {
    const { client, deleteCalls } = fakeClient();

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, true);
    assert.deepEqual(deleteCalls, ["tag-1"]);
  });
});

describe("deleteTagCore — permission check", () => {
  it("returns a clear message when the actor is not admin", async () => {
    const { client, deleteCalls } = fakeClient();

    const result = await deleteTagCore("tag-1", false, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Only an admin can delete a shared tag.");
    }
    assert.equal(deleteCalls.length, 0);
  });
});

describe("deleteTagCore — in-use tag is blocked, not silently deleted (AC2)", () => {
  it("refuses to delete a tag with one assignment, and reports the count", async () => {
    const { client, deleteCalls } = fakeClient({
      async countAssignments() {
        return 1;
      },
    });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.assignedCount, 1);
      assert.ok(result.message.includes("1 client"));
    }
    assert.equal(deleteCalls.length, 0);
  });

  it("uses correct pluralisation for multiple assignments", async () => {
    const { client } = fakeClient({
      async countAssignments() {
        return 5;
      },
    });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.message.includes("5 clients"));
    }
  });

  it("never even attempts the delete when the tag is in use", async () => {
    const { client, deleteCalls } = fakeClient({
      async countAssignments() {
        return 3;
      },
    });

    await deleteTagCore("tag-1", true, client);

    assert.equal(deleteCalls.length, 0);
  });
});

describe("deleteTagCore — genuine failure", () => {
  it("returns a safe message when the delete itself fails", async () => {
    const { client } = fakeClient({
      async deleteTag() {
        return { ok: false, message: "connection lost internally" };
      },
    });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(!result.message.includes("connection lost"));
    }
  });
});
