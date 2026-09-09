import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { clearPlanCache, setCachedPlan } from "./nl-plan-cache.ts";
import { EMPTY_PLAN } from "./nl-search-plan.ts";
import {
  runNlSearch,
  SEARCH_UNAVAILABLE_MESSAGE,
  type RunNlSearchDeps,
} from "./run-nl-search.ts";

const VOCAB = { cities: ["Leeds", "Bristol"], countryCodes: ["GB"] };

/** Allows every call and records that it was asked. */
function allowingLimiter(calls: { count: number }) {
  return {
    rpc: async () => {
      calls.count += 1;
      return { data: null, error: null };
    },
  };
}

function deps(overrides: Partial<RunNlSearchDeps> = {}): RunNlSearchDeps {
  return {
    interpret: async () => ({ plan: { ...EMPTY_PLAN, cities: ["Leeds"] }, cached: false }),
    rateLimitClient: { rpc: async () => ({ data: null, error: null }) },
    ...overrides,
  };
}

describe("runNlSearch", () => {
  beforeEach(() => clearPlanCache());

  it("returns null when there is nothing to search", async () => {
    assert.equal(await runNlSearch("   ", VOCAB, deps(), "user-1"), null);
    assert.equal(await runNlSearch(null, VOCAB, deps(), "user-1"), null);
  });

  it("never calls the model for something that reads as a name", async () => {
    // The single biggest cost control in the feature.
    let called = false;
    const outcome = await runNlSearch(
      "Leeds Community Foundation",
      VOCAB,
      deps({
        interpret: async () => {
          called = true;
          throw new Error("should not be reached");
        },
      }),
      "user-1",
    );
    assert.equal(called, false);
    assert.deepEqual(outcome, { kind: "literal", query: "Leeds Community Foundation" });
  });

  it("serves a cached plan without spending an allowance", async () => {
    // Paging through results must cost neither money nor a CAM's daily budget.
    setCachedPlan("small education charities in leeds", { ...EMPTY_PLAN, cities: ["Leeds"] });
    const calls = { count: 0 };
    const outcome = await runNlSearch(
      "small education charities in Leeds",
      VOCAB,
      deps({
        rateLimitClient: allowingLimiter(calls),
        interpret: async () => {
          throw new Error("should not be reached");
        },
      }),
      "user-1",
    );
    assert.equal(calls.count, 0);
    assert.equal(outcome?.kind, "interpreted");
    assert.equal(outcome?.kind === "interpreted" && outcome.cached, true);
  });

  it("grounds the plan against the data before returning it", async () => {
    const outcome = await runNlSearch(
      "education charities in Atlantis",
      VOCAB,
      deps({
        interpret: async () => ({ plan: { ...EMPTY_PLAN, cities: ["Atlantis"] }, cached: false }),
      }),
      "user-1",
    );
    assert.equal(outcome?.kind, "interpreted");
    if (outcome?.kind === "interpreted") {
      assert.deepEqual(outcome.plan.cities, []);
      assert.deepEqual(outcome.plan.dropped, ["Atlantis"]);
    }
  });

  it("declines to call a paid API when the allowance cannot be metered", async () => {
    // Fail closed, exactly as the booklet and draft routes do.
    let called = false;
    const outcome = await runNlSearch(
      "small education charities in Leeds",
      VOCAB,
      deps({
        rateLimitClient: null,
        interpret: async () => {
          called = true;
          throw new Error("should not be reached");
        },
      }),
      "user-1",
    );
    assert.equal(called, false);
    assert.deepEqual(outcome, {
      kind: "error",
      query: "small education charities in Leeds",
      message: SEARCH_UNAVAILABLE_MESSAGE,
    });
  });

  it("stops at the rate limit before calling the model", async () => {
    let called = false;
    const retryAt = new Date(Date.now() + 3_600_000).toISOString();
    const outcome = await runNlSearch(
      "small education charities in Leeds",
      VOCAB,
      deps({
        rateLimitClient: { rpc: async () => ({ data: retryAt, error: null }) },
        interpret: async () => {
          called = true;
          throw new Error("should not be reached");
        },
      }),
      "user-1",
    );
    assert.equal(called, false);
    assert.equal(outcome?.kind, "error");
    assert.ok(outcome?.kind === "error" && outcome.message.includes("search limit"));
  });

  it("spends the allowance from the search bucket, not the generation one", async () => {
    // Otherwise twenty searches would cost a CAM their booklet allowance.
    const seen: Record<string, unknown>[] = [];
    await runNlSearch(
      "small education charities in Leeds",
      VOCAB,
      deps({
        rateLimitClient: {
          rpc: async (_name, args) => {
            seen.push(args);
            return { data: null, error: null };
          },
        },
      }),
      "user-1",
    );
    assert.equal(seen[0].p_bucket, "search");
  });

  it("surfaces an interpretation failure as an error outcome", async () => {
    const outcome = await runNlSearch(
      "small education charities in Leeds",
      VOCAB,
      deps({ interpret: async () => ({ error: "Nope." }) }),
      "user-1",
    );
    assert.deepEqual(outcome, {
      kind: "error",
      query: "small education charities in Leeds",
      message: "Nope.",
    });
  });

  it("truncates an over-long question rather than paying to send it", async () => {
    const seen: string[] = [];
    await runNlSearch(
      `${"charities in Leeds ".repeat(40)}`,
      VOCAB,
      deps({
        interpret: async (query) => {
          seen.push(query);
          return { plan: EMPTY_PLAN, cached: false };
        },
      }),
      "user-1",
    );
    assert.ok(seen[0].length <= 200);
  });
});
