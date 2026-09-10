import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { clearPlanCache } from "./nl-plan-cache.ts";
import {
  INTERPRETATION_FAILED_MESSAGE,
  interpretQuery,
  MAX_OUTPUT_TOKENS,
  resolveSearchModel,
  TIMEOUT_MS,
  type CallSearchModelFn,
} from "./interpret-query.ts";

const PLAN_JSON = JSON.stringify({ cities: ["Leeds"], sectors: ["education"] });

function deps(call: CallSearchModelFn) {
  return { callSearchModel: call };
}

const ok: CallSearchModelFn = async () => ({
  text: PLAN_JSON,
  model: "gemini-3.5-flash-lite",
  inputTokens: 700,
  outputTokens: 90,
});

describe("interpretQuery", () => {
  beforeEach(() => clearPlanCache());

  it("returns a validated plan on success", async () => {
    const result = await interpretQuery("small education charities in Leeds", deps(ok));
    assert.ok("plan" in result);
    assert.deepEqual(result.plan.cities, ["Leeds"]);
    assert.equal(result.cached, false);
  });

  it("serves a repeat query from cache without calling the model again", async () => {
    // The cost control that makes pagination free.
    let calls = 0;
    const counting: CallSearchModelFn = async (input) => {
      calls += 1;
      return ok(input);
    };
    await interpretQuery("charities in Leeds with no response", deps(counting));
    const second = await interpretQuery("Charities In Leeds With No Response  ", deps(counting));
    assert.equal(calls, 1);
    assert.ok("plan" in second);
    assert.equal(second.cached, true);
  });

  it("reports a clear error when the call throws", async () => {
    const result = await interpretQuery(
      "small education charities in Leeds",
      deps(async () => {
        throw new Error("503 upstream unavailable");
      }),
    );
    assert.deepEqual(result, { error: INTERPRETATION_FAILED_MESSAGE });
  });

  it("reports a clear error when the call times out", async () => {
    const result = await interpretQuery(
      "small education charities in Leeds",
      deps(async () => {
        throw Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        });
      }),
    );
    assert.deepEqual(result, { error: INTERPRETATION_FAILED_MESSAGE });
  });

  it("treats an unusable response as a failure, not an empty search", async () => {
    // Showing the unfiltered list as though the question had been understood is
    // the one outcome AC2 rules out.
    const result = await interpretQuery(
      "small education charities in Leeds",
      deps(async () => ({ text: "I'm sorry, I can't help with that.", model: "m" })),
    );
    assert.deepEqual(result, { error: INTERPRETATION_FAILED_MESSAGE });
  });

  it("does not cache a failure — the next attempt is a real retry", async () => {
    let calls = 0;
    const flaky: CallSearchModelFn = async (input) => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return ok(input);
    };
    const first = await interpretQuery("charities in Leeds needing follow up", deps(flaky));
    assert.ok("error" in first);
    const second = await interpretQuery("charities in Leeds needing follow up", deps(flaky));
    assert.ok("plan" in second);
  });

  it("never leaks the underlying failure to the CAM", async () => {
    const result = await interpretQuery(
      "small education charities in Leeds",
      deps(async () => {
        throw new Error("GEMINI_API_KEY=AQ.secret rejected by provider");
      }),
    );
    assert.ok("error" in result);
    assert.ok(!result.error.includes("GEMINI_API_KEY"));
    assert.ok(!result.error.toLowerCase().includes("gemini"));
  });
});

describe("resolveSearchModel", () => {
  it("prefers the dedicated cheaper search model", () => {
    assert.equal(
      resolveSearchModel({ GEMINI_SEARCH_MODEL: "gemini-3.5-flash-lite", GEMINI_MODEL: "gemini-3.6-flash" }),
      "gemini-3.5-flash-lite",
    );
  });

  it("falls back to the generation model so search still works", () => {
    assert.equal(resolveSearchModel({ GEMINI_MODEL: "gemini-3.6-flash" }), "gemini-3.6-flash");
  });

  it("is null when neither is configured", () => {
    assert.equal(resolveSearchModel({}), null);
  });
});

describe("cost ceilings", () => {
  it("caps output tokens and keeps the timeout short enough to be a search", () => {
    // Both are the difference between a bounded cost and an open one; a change
    // to either should be a deliberate decision, not a drift.
    assert.equal(MAX_OUTPUT_TOKENS, 512);
    assert.ok(TIMEOUT_MS <= 15_000);
  });
});
