import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { clearPlanCache, getCachedPlan, setCachedPlan } from "./nl-plan-cache.ts";
import { EMPTY_PLAN } from "./nl-search-plan.ts";

const plan = { ...EMPTY_PLAN, cities: ["Leeds"] };

describe("nl-plan-cache", () => {
  beforeEach(() => clearPlanCache());

  it("returns a stored plan", () => {
    setCachedPlan("k", plan);
    assert.deepEqual(getCachedPlan("k"), plan);
  });

  it("misses on an unknown key", () => {
    assert.equal(getCachedPlan("nope"), null);
  });

  it("expires an entry once its TTL passes", () => {
    const now = 1_000_000;
    setCachedPlan("k", plan, now);
    assert.deepEqual(getCachedPlan("k", now + 59 * 60 * 1000), plan);
    assert.equal(getCachedPlan("k", now + 61 * 60 * 1000), null);
  });

  it("evicts least-recently-used, not oldest-inserted", () => {
    for (let i = 0; i < 500; i += 1) setCachedPlan(`k${i}`, plan);
    // Touching the first entry should save it from the next eviction.
    assert.notEqual(getCachedPlan("k0"), null);
    setCachedPlan("overflow", plan);
    assert.notEqual(getCachedPlan("k0"), null);
    assert.equal(getCachedPlan("k1"), null);
  });
});
