import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getMentionDirectory,
  parseMentionDirectoryResponse,
  resetMentionDirectoryCache,
} from "./mention-directory.ts";

describe("parseMentionDirectoryResponse (F485)", () => {
  it("keeps well-formed candidates and trims names", () => {
    assert.deepEqual(
      parseMentionDirectoryResponse({
        users: [
          { id: "a", fullName: "  Alice Ahmed " },
          { id: "b", fullName: "Bob Osei" },
        ],
      }),
      [
        { id: "a", fullName: "Alice Ahmed" },
        { id: "b", fullName: "Bob Osei" },
      ],
    );
  });

  it("drops malformed rows rather than throwing", () => {
    assert.deepEqual(
      parseMentionDirectoryResponse({
        users: [
          null,
          "nope",
          { id: "", fullName: "No Id" },
          { id: "c", fullName: "   " },
          { id: "d", fullName: null },
          { id: "e", fullName: "Fine" },
        ],
      }),
      [{ id: "e", fullName: "Fine" }],
    );
  });

  it("returns empty for a malformed payload", () => {
    assert.deepEqual(parseMentionDirectoryResponse(null), []);
    assert.deepEqual(parseMentionDirectoryResponse({}), []);
    assert.deepEqual(parseMentionDirectoryResponse({ users: "nope" }), []);
  });
});

describe("getMentionDirectory caching (F485)", () => {
  it("shares one request across callers", async () => {
    resetMentionDirectoryCache();
    let calls = 0;
    const stub = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ users: [] }) } as Response;
    };
    const [first, second] = await Promise.all([
      getMentionDirectory(stub as typeof fetch),
      getMentionDirectory(stub as typeof fetch),
    ]);
    assert.deepEqual(first, []);
    assert.deepEqual(second, []);
    assert.equal(calls, 1);
    resetMentionDirectoryCache();
  });

  it("retries after a failure instead of caching it", async () => {
    resetMentionDirectoryCache();
    const failing = async () => ({ ok: false, json: async () => ({}) }) as Response;
    await assert.rejects(() => getMentionDirectory(failing as typeof fetch));
    let calls = 0;
    const succeeding = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ users: [] }) } as Response;
    };
    await getMentionDirectory(succeeding as typeof fetch);
    assert.equal(calls, 1);
    resetMentionDirectoryCache();
  });
});
