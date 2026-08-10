import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { reconcileOne } from "./find_that_charity.ts";

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("reconcileOne — successful match", () => {
  it("returns the candidate marked match: true", async () => {
    globalThis.fetch = mock.fn(async () =>
      jsonResponse({
        q0: {
          result: [
            { id: "GB-CHC-202918", name: "Oxfam International", score: 61, match: false },
            { id: "GB-CHC-202918-A", name: "Oxfam", score: 92, match: true },
          ],
        },
      }),
    );

    const result = await reconcileOne("Oxfam");

    assert.equal(result?.id, "GB-CHC-202918-A");
    assert.equal(result?.match, true);
  });

  it("falls back to the first candidate when nothing is marked match: true", async () => {
    globalThis.fetch = mock.fn(async () =>
      jsonResponse({
        q0: {
          result: [
            { id: "GB-CHC-1", name: "Some Charity", score: 40, match: false },
            { id: "GB-CHC-2", name: "Some Other Charity", score: 35, match: false },
          ],
        },
      }),
    );

    const result = await reconcileOne("Some Charity");

    assert.equal(result?.id, "GB-CHC-1");
  });

  it("URL-encodes the query so special characters in a charity name don't break the request", async () => {
    let seenUrl = "";
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse({ q0: { result: [] } });
    });

    await reconcileOne("St Mary's & Co. Trust");

    assert.ok(!seenUrl.includes("&Co"), "raw ampersand must not appear unencoded in the URL");
  });
});

describe("reconcileOne — no match / empty results", () => {
  it("returns null when the result array is empty", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ q0: { result: [] } }));

    const result = await reconcileOne("Nonexistent Charity Name");

    assert.equal(result, null);
  });

  it("returns null when the response has no q0 key at all", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({}));

    const result = await reconcileOne("Some Name");

    assert.equal(result, null);
  });

  it("returns null when q0.result is not an array", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ q0: { result: "not an array" } }));

    const result = await reconcileOne("Some Name");

    assert.equal(result, null);
  });
});

describe("reconcileOne — API failure", () => {
  it("throws after exhausting retries on a persistent 500", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse({ error: "down" }, 500));

    await assert.rejects(
      () => reconcileOne("Some Charity"),
      /Find That Charity API returned 500/,
    );
  });

  it("recovers from a transient 429", async () => {
    let calls = 0;
    globalThis.fetch = mock.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse({ error: "rate limited" }, 429);
      return jsonResponse({ q0: { result: [{ id: "GB-CHC-1", name: "X", score: 90, match: true }] } });
    });

    const result = await reconcileOne("Some Charity");

    assert.ok(calls >= 2, "must have retried after the 429");
    assert.equal(result?.id, "GB-CHC-1");
  });
});

describe("reconcileOne — malformed response", () => {
  it("does not crash on a response body that isn't valid JSON shape it expects", async () => {
    globalThis.fetch = mock.fn(async () => jsonResponse(null));

    const result = await reconcileOne("Some Charity");

    assert.equal(result, null);
  });
});
