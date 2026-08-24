import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  setTagColourCore,
  type TagColourRpcClient,
} from "./set-tag-colour-core.ts";

function fakeRpc(
  impl?: TagColourRpcClient["setTagColour"],
): { client: TagColourRpcClient; calls: [string, string | null][] } {
  const calls: [string, string | null][] = [];
  const client: TagColourRpcClient = {
    async setTagColour(tagId, colour) {
      calls.push([tagId, colour]);
      if (impl) return impl(tagId, colour);
      return {
        ok: true,
        tag: { id: tagId, name: "Urgent", colour },
      };
    },
  };
  return { client, calls };
}

describe("setTagColourCore — success (F194 AC3)", () => {
  it("sends a chosen palette colour to the RPC", async () => {
    const { client, calls } = fakeRpc();

    const result = await setTagColourCore("tag-1", "#175CD3", client);

    assert.deepEqual(calls, [["tag-1", "#175cd3"]]);
    assert.deepEqual(result, {
      ok: true,
      tag: { id: "tag-1", name: "Urgent", colour: "#175cd3" },
    });
  });

  it("clearing sends an explicit null rather than skipping the write", async () => {
    const { client, calls } = fakeRpc();

    const result = await setTagColourCore("tag-1", "", client);

    assert.deepEqual(calls, [["tag-1", null]]);
    if (result.ok) assert.equal(result.tag.colour, null);
  });

  it("refuses an invalid colour before the RPC is called at all", async () => {
    const { client, calls } = fakeRpc();

    const result = await setTagColourCore("tag-1", "#ff0000", client);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /palette/i);
    assert.equal(calls.length, 0);
  });
});

describe("setTagColourCore — failure mapping", () => {
  it("maps P0002 to a clear 'no longer exists' message", async () => {
    const { client } = fakeRpc(async () => ({
      ok: false,
      code: "P0002",
      message: "no data found",
    }));

    const result = await setTagColourCore("tag-gone", "#067647", client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "This tag no longer exists.");
    }
  });

  it("maps an RPC permission refusal to a permission message", async () => {
    const { client } = fakeRpc(async () => ({
      ok: false,
      code: "42501",
      message: "insufficient_privilege",
    }));

    const result = await setTagColourCore("tag-1", "#067647", client);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /permission/i);
  });

  it("never surfaces the raw database error for unexpected failures", async () => {
    const { client } = fakeRpc(async () => ({
      ok: false,
      code: "08006",
      message: "connection failure",
    }));

    const result = await setTagColourCore("tag-1", "#067647", client);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.message,
        "The colour could not be saved. Please try again later.",
      );
      assert.ok(!result.message.includes("connection failure"));
    }
  });
});
