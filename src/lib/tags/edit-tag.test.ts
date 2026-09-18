import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { editTagCore, type TagUpdateClient } from "./edit-tag-core.ts";

function fakeClient(overrides: Partial<TagUpdateClient> = {}) {
  const updateCalls: { tagId: string; newName: string }[] = [];
  const client: TagUpdateClient = {
    async updateTagName(tagId, newName) {
      updateCalls.push({ tagId, newName });
      return { ok: true, tag: { id: tagId, name: newName } };
    },
    ...overrides,
  };
  return { client, updateCalls };
}

describe("editTagCore — successful edit (AC1, AC2)", () => {
  it("updates the tag name when the actor is admin", async () => {
    const { client, updateCalls } = fakeClient();

    const result = await editTagCore("tag-1", "Urgent v2", true, client);

    assert.equal(result.ok, true);
    assert.deepEqual(updateCalls, [{ tagId: "tag-1", newName: "Urgent v2" }]);
  });

  it("only updates the tags row — never touches org_tags, so existing assignments survive by construction", async () => {
    const { client } = fakeClient();
    // The fake client's only capability is updateTagName; there is no way
    // for editTagCore to reach org_tags even by mistake.
    const result = await editTagCore("tag-1", "New Name", true, client);
    assert.equal(result.ok, true);
  });
});

describe("editTagCore — permission check (AC3)", () => {
  it("returns a clear message, not a silent failure, when the actor is not admin", async () => {
    const { client, updateCalls } = fakeClient();

    const result = await editTagCore("tag-1", "Urgent v2", false, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Only an admin can edit a shared tag.");
    }
    assert.equal(updateCalls.length, 0);
  });
});

describe("editTagCore — validation", () => {
  it("rejects an empty name without attempting the update", async () => {
    const { client, updateCalls } = fakeClient();

    const result = await editTagCore("tag-1", "", true, client);

    assert.equal(result.ok, false);
    assert.equal(updateCalls.length, 0);
  });

  it("rejects a whitespace-only name", async () => {
    const { client } = fakeClient();
    const result = await editTagCore("tag-1", "   ", true, client);
    assert.equal(result.ok, false);
  });
});

describe("editTagCore — duplicate name", () => {
  it("returns a specific message on a unique-constraint violation", async () => {
    const { client } = fakeClient({
      async updateTagName() {
        return { ok: false, code: "23505", message: "duplicate key value" };
      },
    });

    const result = await editTagCore("tag-1", "Existing Tag", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, 'A tag named "Existing Tag" already exists.');
    }
  });
});

describe("editTagCore — unexpected failure", () => {
  it("returns a safe message without leaking raw database error text", async () => {
    const { client } = fakeClient({
      async updateTagName() {
        return { ok: false, code: null, message: "connection lost internally" };
      },
    });

    const result = await editTagCore("tag-1", "New Name", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(!result.message.includes("connection lost"));
    }
  });
});
