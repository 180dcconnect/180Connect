import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDefaultGenerateBookletDeps,
  generateBooklet,
  type CallGeminiFn,
} from "./generate-booklet.ts";

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
  it("returns the trimmed booklet text, model, and exact prompts on success", async () => {
    const result = await generateBooklet(
      INPUT,
      fakeDeps(async () => ({ text: "  A short booklet about Test Charity.  ", model: "gemini-test" })),
    );
    assert.ok(!("error" in result));
    assert.equal(result.booklet, "A short booklet about Test Charity.");
    assert.equal(result.model, "gemini-test");
    assert.match(result.systemPrompt, /never invent/i);
    assert.match(result.userPrompt, /Test Charity/);
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
        return { text: "booklet text", model: "gemini-test" };
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

  it("threads a scraped websiteContext through to the prompt (F084)", async () => {
    let calls = 0;
    await generateBooklet(
      {
        ...INPUT,
        websiteContext: { text: "We run weekly youth clubs.", hostname: "test-charity.org" },
      },
      fakeDeps(async (input) => {
        calls += 1;
        assert.match(input.prompt, /We run weekly youth clubs\./);
        return { text: "booklet text", model: "gemini-test" };
      }),
    );
    assert.equal(calls, 1);
  });

  it("omits any website-context section when none was scraped", async () => {
    await generateBooklet(
      { ...INPUT, websiteContext: null },
      fakeDeps(async (input) => {
        assert.doesNotMatch(input.prompt, /Extracted text from/);
        return { text: "booklet text", model: "gemini-test" };
      }),
    );
  });

  it("treats an empty response as a failure rather than an empty success", async () => {
    const result = await generateBooklet(
      INPUT,
      fakeDeps(async () => ({ text: "   ", model: "gemini-test" })),
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

  // Review finding on PR #368: createDefaultGenerateBookletDeps() used to validate
  // GEMINI_API_KEY/GEMINI_MODEL eagerly (at construction, before generateBooklet's
  // own try/catch is ever entered), so a missing env var threw straight past this
  // file's error handling — no ERROR_LOG, no API_HEALTH_LOGS, no clean {error}
  // response, contradicting AC3. These prove the fix: construction never throws,
  // and the missing-config failure is caught and reported exactly like any other
  // upstream failure.
  describe("missing Gemini configuration (PR #368 review)", () => {
    const originalKey = process.env.GEMINI_API_KEY;
    const originalModel = process.env.GEMINI_MODEL;

    function withoutGeminiEnv(run: () => Promise<void>) {
      return async () => {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_MODEL;
        try {
          await run();
        } finally {
          if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
          else process.env.GEMINI_API_KEY = originalKey;
          if (originalModel === undefined) delete process.env.GEMINI_MODEL;
          else process.env.GEMINI_MODEL = originalModel;
        }
      };
    }

    it(
      "does not throw when constructing default deps with no env configured",
      withoutGeminiEnv(async () => {
        assert.doesNotThrow(() => createDefaultGenerateBookletDeps());
      }),
    );

    it(
      "surfaces missing configuration through the normal error contract, not an uncaught throw",
      withoutGeminiEnv(async () => {
        const deps = createDefaultGenerateBookletDeps();
        const result = await generateBooklet(INPUT, deps);
        assert.deepEqual(result, { error: "The booklet could not be generated. Try again." });
      }),
    );
  });
});
