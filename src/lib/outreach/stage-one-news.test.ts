import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeHookText, resolveStageOneNews } from "./stage-one-news.ts";

describe("composeHookText", () => {
  it("appends the article URL on its own Source line", () => {
    assert.equal(
      composeHookText({ text: "Charity opens new centre (bbc.co.uk, March 2026)", url: "https://bbc.co.uk/x" }),
      "Charity opens new centre (bbc.co.uk, March 2026)\nSource: https://bbc.co.uk/x",
    );
  });

  it("leaves the hook alone when the article had no usable URL", () => {
    assert.equal(composeHookText({ text: "Charity opens new centre", url: null }), "Charity opens new centre");
  });
});

/**
 * The behaviour worth pinning here is *when* the lookup runs, not what Exa
 * returns — the relevance gate has its own tests in news-hook.test.ts — so the
 * lookup arrives through the injected seam.
 */
describe("resolveStageOneNews", () => {
  const ORG = {
    organisationId: "11111111-1111-1111-1111-111111111111",
    organisationName: "Sheffield Wellbeing Trust",
  };

  function fakeLookup(hook: { text: string; url: string | null } | null) {
    const calls: unknown[] = [];
    return {
      calls,
      lookup: async (input: unknown) => {
        calls.push(input);
        return hook;
      },
    };
  }

  it("does not spend a lookup on an opening that would ignore the hook", async () => {
    const { lookup, calls } = fakeLookup({ text: "A story", url: null });
    for (const opening of ["mission_led", "direct_intro"] as const) {
      const result = await resolveStageOneNews({ ...ORG, opening }, lookup);
      assert.equal(result.source, "none");
      assert.deepEqual(result.hooks, []);
    }
    assert.equal(calls.length, 0);
  });

  it("looks a story up when the news opening was chosen, and carries the Source line", async () => {
    const { lookup, calls } = fakeLookup({ text: "A story", url: "https://example.org/a" });
    const result = await resolveStageOneNews({ ...ORG, opening: "news_hook" }, lookup);
    assert.equal(calls.length, 1);
    assert.equal(result.source, "live");
    assert.deepEqual(result.hooks, ["A story\nSource: https://example.org/a"]);
    assert.equal(result.live?.url, "https://example.org/a");
  });

  it("falls back to no hook when the lookup finds nothing, rather than failing", async () => {
    const { lookup } = fakeLookup(null);
    const result = await resolveStageOneNews({ ...ORG, opening: "news_hook" }, lookup);
    assert.equal(result.source, "none");
    assert.deepEqual(result.hooks, []);
    assert.equal(result.live, null);
  });

  it("keeps stored hooks for a non-news opening, unchanged from before this feature", async () => {
    const { lookup } = fakeLookup(null);
    const result = await resolveStageOneNews(
      { ...ORG, opening: "mission_led", storedHooks: ["An old stored hook"] },
      lookup,
    );
    assert.equal(result.source, "stored");
    assert.deepEqual(result.hooks, ["An old stored hook"]);
  });

  it("prefers a live hit over a stored hook", async () => {
    const { lookup } = fakeLookup({ text: "Fresh story", url: null });
    const result = await resolveStageOneNews(
      { ...ORG, opening: "news_hook", storedHooks: ["An old stored hook"] },
      lookup,
    );
    assert.equal(result.source, "live");
    assert.deepEqual(result.hooks, ["Fresh story"]);
  });
});
