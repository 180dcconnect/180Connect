import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateBooklet, type CallGeminiFn } from "./generate-booklet.ts";

const INPUT = {
  organisationId: "org-1",
  organisation: {
    legal_name: "Test Charity",
    organisation_type: "charity",
    website: "https://test-charity.org",
    city: "London",
    country_code: "GB",
  },
  enrichment: null,
};

function fakeDeps(callGemini: CallGeminiFn) {
  return { callGemini };
}

describe("generateBooklet", () => {
  it("returns the trimmed booklet text on success", async () => {
    const result = await generateBooklet(
      INPUT,
      fakeDeps(async () => "  A short booklet about Test Charity.  "),
    );
    assert.deepEqual(result, { booklet: "A short booklet about Test Charity." });
  });

  it("passes the built prompt through to callGemini", async () => {
    let calls = 0;
    await generateBooklet(
      INPUT,
      fakeDeps(async (input) => {
        calls += 1;
        assert.match(input.prompt, /Test Charity/);
        assert.match(input.system, /never invent/i);
        assert.equal(typeof input.timeoutMs, "number");
        return "booklet text";
      }),
    );
    assert.equal(calls, 1);
  });

  it("returns a generic error, not the raw exception, when the call throws", async () => {
    const result = await generateBooklet(
      INPUT,
      fakeDeps(async () => {
        throw new Error("upstream 500 with some internal detail");
      }),
    );
    assert.deepEqual(result, { error: "The booklet could not be generated. Try again." });
  });

  it("treats an empty response as a failure rather than an empty success", async () => {
    const result = await generateBooklet(
      INPUT,
      fakeDeps(async () => "   "),
    );
    assert.ok("error" in result);
  });

  it("returns a generic error on timeout (abort-shaped rejection)", async () => {
    const result = await generateBooklet(
      INPUT,
      fakeDeps(async () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }),
    );
    assert.deepEqual(result, { error: "The booklet could not be generated. Try again." });
  });
});
