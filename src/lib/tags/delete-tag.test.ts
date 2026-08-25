import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deleteTagCore,
  type TagDeleteClient,
  type TagDeleteOutcome,
} from "./delete-tag-core.ts";

function fakeClient(outcome: TagDeleteOutcome) {
  const calls: string[] = [];
  const client: TagDeleteClient = {
    async deleteUnusedTag(tagId) {
      calls.push(tagId);
      return outcome;
    },
  };
  return { client, calls };
}

describe("deleteTagCore — successful delete, unused tag", () => {
  it("deletes a tag the database reports as unused", async () => {
    const { client, calls } = fakeClient({ status: "deleted" });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["tag-1"]);
  });

  it("treats an already-deleted tag as success (idempotent end state)", async () => {
    const { client } = fakeClient({ status: "not_found" });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, true);
  });
});

describe("deleteTagCore — permission check", () => {
  it("returns a clear message when the actor is not admin, without calling the database", async () => {
    const { client, calls } = fakeClient({ status: "deleted" });

    const result = await deleteTagCore("tag-1", false, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Only an admin can delete a shared tag.");
    }
    assert.equal(calls.length, 0);
  });

  it("surfaces the database's own refusal when the RPC says forbidden", async () => {
    const { client } = fakeClient({ status: "forbidden" });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Only an admin can delete a shared tag.");
    }
  });
});

describe("deleteTagCore — in-use tag is blocked, not silently deleted (AC2)", () => {
  it("refuses to delete a tag with one assignment, and reports the count", async () => {
    const { client } = fakeClient({
      status: "in_use",
      assignedCount: 1,
    });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.assignedCount, 1);
      assert.ok(result.message.includes("1 client"));
      assert.ok(!result.message.includes("1 clients"));
    }
  });

  it("uses correct pluralisation for multiple assignments", async () => {
    const { client } = fakeClient({
      status: "in_use",
      assignedCount: 5,
    });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.message.includes("5 clients"));
    }
  });
});

describe("deleteTagCore — check failure is honest (review finding #3)", () => {
  it("blocks deletion but never claims an assignment count it did not observe", async () => {
    const { client } = fakeClient({ status: "check_failed" });

    const result = await deleteTagCore("tag-1", true, client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.message,
        "We couldn't check whether this tag is in use. Please try again.",
      );
      assert.equal(result.assignedCount, undefined);
      // The misleading message this replaces told the user a specific
      // number of clients held the tag.
      assert.ok(!/[0-9]/.test(result.message));
    }
  });
});
