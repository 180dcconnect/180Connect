import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSupabaseTagInsertClient,
  type TagsTableClient,
} from "./create-tag-supabase-client.ts";

function fakeSupabase(
  result: { data: { id: string; name: string } | null; error: { code?: string | null; message: string } | null },
): { client: TagsTableClient; insertCalls: unknown[] } {
  const insertCalls: unknown[] = [];
  const client: TagsTableClient = {
    from(_table) {
      return {
        insert(row) {
          insertCalls.push(row);
          return {
            select(_columns) {
              return {
                async single() {
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, insertCalls };
}

describe("buildSupabaseTagInsertClient — the real Supabase write", () => {
  it("calls insert with the correct row shape and returns the created tag", async () => {
    const { client, insertCalls } = fakeSupabase({
      data: { id: "tag-1", name: "Urgent" },
      error: null,
    });

    const insertClient = buildSupabaseTagInsertClient(client);
    const result = await insertClient.insertTag("Urgent", "user-1");

    assert.deepEqual(insertCalls, [
      { name: "Urgent", created_by_user_id: "user-1" },
    ]);
    assert.deepEqual(result, { ok: true, tag: { id: "tag-1", name: "Urgent" } });
  });
});

describe("buildSupabaseTagInsertClient — error reporting", () => {
  it("returns the error code and message on failure", async () => {
    const { client } = fakeSupabase({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });

    const insertClient = buildSupabaseTagInsertClient(client);
    const result = await insertClient.insertTag("Urgent", "user-1");

    assert.deepEqual(result, {
      ok: false,
      code: "23505",
      message: "duplicate key value",
    });
  });

  it("passes null code through when the database error has none", async () => {
    const { client } = fakeSupabase({
      data: null,
      error: { message: "connection lost" },
    });

    const insertClient = buildSupabaseTagInsertClient(client);
    const result = await insertClient.insertTag("Urgent", "user-1");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, null);
      assert.equal(result.message, "connection lost");
    }
  });

  // Review fix (round 2): a network failure or similar throws rather than
  // resolving with { error } — without the try/catch this would reject
  // instead of returning a safe result, and the caller (createTagCore)
  // would see an unhandled exception rather than its usual failure path.
  it("catches a thrown error (e.g. a network failure) instead of rejecting", async () => {
    const client: TagsTableClient = {
      from(_table) {
        return {
          insert(_row) {
            return {
              select(_columns) {
                return {
                  async single() {
                    throw new Error("fetch failed");
                  },
                };
              },
            };
          },
        };
      },
    };

    const insertClient = buildSupabaseTagInsertClient(client);
    const result = await insertClient.insertTag("Urgent", "user-1");

    assert.deepEqual(result, {
      ok: false,
      code: null,
      message: "fetch failed",
    });
  });
});