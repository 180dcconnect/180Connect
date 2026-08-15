import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SOURCE_PRIORITY,
  resolveBySourcePriority,
  sourcePriority,
} from "./source-priority.ts";

describe("sourcePriority", () => {
  it("ranks Companies House above the Charity Commission", () => {
    assert.ok(sourcePriority("companies_house") < sourcePriority("charity_commission"));
  });

  it("falls back to least priority for a source nobody has ranked yet", () => {
    assert.equal(sourcePriority("find_that_charity"), DEFAULT_SOURCE_PRIORITY);
  });
});

describe("resolveBySourcePriority", () => {
  it("picks the incoming value when the incoming source outranks the existing one", () => {
    assert.equal(resolveBySourcePriority("charity_commission", "companies_house"), "incoming");
  });

  it("picks the existing value when the existing source outranks the incoming one", () => {
    assert.equal(resolveBySourcePriority("companies_house", "charity_commission"), "existing");
  });

  it("declines to decide when both values came from the same source", () => {
    assert.equal(resolveBySourcePriority("companies_house", "companies_house"), null);
  });

  it("declines to decide when either source is unranked, rather than treating it as a loser", () => {
    // The distinction from sourcePriority's 99 fallback: writing a number for an
    // unranked source is harmless, but silently overwriting a field on the
    // strength of that number is not.
    assert.equal(resolveBySourcePriority("find_that_charity", "companies_house"), null);
    assert.equal(resolveBySourcePriority("companies_house", "find_that_charity"), null);
  });

  it("declines to decide when the existing value's provenance is unknown", () => {
    assert.equal(resolveBySourcePriority("unknown", "companies_house"), null);
  });
});
