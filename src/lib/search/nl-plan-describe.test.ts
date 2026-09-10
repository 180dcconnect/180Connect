import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeResolvedPlan,
  planFilterParams,
  planHasUnconvertibleParts,
} from "./nl-plan-describe.ts";
import { EMPTY_PLAN } from "./nl-search-plan.ts";
import type { ResolvedNlPlan } from "./nl-search-apply.ts";

const plan = (overrides: Partial<ResolvedNlPlan> = {}): ResolvedNlPlan => ({
  ...EMPTY_PLAN,
  dropped: [],
  ...overrides,
});

describe("describeResolvedPlan", () => {
  it("labels each part in the words the CAM already knows from the filters", () => {
    const chips = describeResolvedPlan(
      plan({ cities: ["Leeds"], sectors: ["education"], statuses: ["not_contacted"] }),
    );
    assert.deepEqual(
      chips.map((c) => `${c.category}: ${c.label}`),
      ["City: Leeds", "Sector: Education", "Status: Not contacted"],
    );
  });

  it("marks the parts no manual filter can hold", () => {
    const chips = describeResolvedPlan(plan({ incomeBands: ["10k_100k"], keywords: ["music"] }));
    assert.deepEqual(chips.map((c) => c.param), [null, null]);
    assert.equal(chips[0].label, "£10k – £100k");
    assert.equal(chips[1].category, "Ranked on");
  });

  it("says nothing about a plan with nothing in it", () => {
    assert.deepEqual(describeResolvedPlan(plan()), []);
  });
});

describe("planFilterParams", () => {
  it("writes only what a manual filter can drive afterwards", () => {
    // Converting has to produce a list the CAM fully owns — anything that would
    // keep applying invisibly from the interpretation is left out.
    const params = planFilterParams(
      plan({ cities: ["Leeds"], sectors: ["education"], incomeBands: ["10k_100k"], keywords: ["music"] }),
    );
    assert.deepEqual(params, { city: ["Leeds"], sector: ["education"] });
  });

  it("omits empty keys so the URL stays clean", () => {
    assert.deepEqual(planFilterParams(plan()), {});
  });
});

describe("planHasUnconvertibleParts", () => {
  it("is true only when converting would lose something", () => {
    assert.equal(planHasUnconvertibleParts(plan({ cities: ["Leeds"] })), false);
    assert.equal(planHasUnconvertibleParts(plan({ keywords: ["music"] })), true);
    assert.equal(planHasUnconvertibleParts(plan({ incomeBands: ["under_10k"] })), true);
  });
});
