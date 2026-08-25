import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSupabaseTagColourClient,
  type TagsRpcClient,
} from "./set-tag-colour-supabase-client.ts";

function fakeSupabase(
  result: {
    data: { id: string; name: string; colour: string | null } | null;
    error: { code?: string | null; message: string } | null;
  } | null,
): { client: TagsRpcClient; rpcCalls: unknown[] } {
  const rpcCalls: unknown[] = [];
  const client: TagsRpcClient = {
    rpc(_fn, params) {
      rpcCalls.push(params);
      return Promise.resolve(result ?? { data: null, error: null });
    },
  };
  return { client, rpcCalls };
}

describe("buildSupabaseTagColourClient — the real RPC write", () => {
  it("calls set_tag_colour with the right parameter names", async () => {
    const { client, rpcCalls } = fakeSupabase({
      data: { id: "tag-1", name: "Urgent", colour: "#067647" },
      error: null,
    });

    const rpcClient = buildSupabaseTagColourClient(client);
    const result = await rpcClient.setTagColour("tag-1", "#067647");

    assert.deepEqual(rpcCalls, [{ p_tag_id: "tag-1", p_colour: "#067647" }]);
    assert.deepEqual(result, {
      ok: true,
      tag: { id: "tag-1", name: "Urgent", colour: "#067647" },
    });
  });

  it("passes a clearing null straight through", async () => {
    const { client, rpcCalls } = fakeSupabase({
      data: { id: "tag-1", name: "Urgent", colour: null },
      error: null,
    });

    const rpcClient = buildSupabaseTagColourClient(client);
    await rpcClient.setTagColour("tag-1", null);

    assert.deepEqual(rpcCalls, [{ p_tag_id: "tag-1", p_colour: null }]);
  });

  it("returns the error code and message on failure", async () => {
    const { client } = fakeSupabase({
      data: null,
      error: { code: "22023", message: "colour must be #rrggbb" },
    });

    const rpcClient = buildSupabaseTagColourClient(client);
    const result = await rpcClient.setTagColour("tag-1", "red");

    assert.deepEqual(result, {
      ok: false,
      code: "22023",
      message: "colour must be #rrggbb",
    });
  });

  it("catches a thrown error (e.g. a network failure) instead of rejecting", async () => {
    const client: TagsRpcClient = {
      rpc() {
        throw new Error("fetch failed");
      },
    };

    const rpcClient = buildSupabaseTagColourClient(client);
    const result = await rpcClient.setTagColour("tag-1", "#067647");

    assert.deepEqual(result, {
      ok: false,
      code: null,
      message: "fetch failed",
    });
  });
});
