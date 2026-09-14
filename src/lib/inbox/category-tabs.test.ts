import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isClosedPipelineStatus,
  isFollowUpExcludedPipelineStatus,
  parseCategoryTabParam,
  tabForThreadStatus,
} from "./category-tabs.ts";

describe("parseCategoryTabParam", () => {
  it("accepts each rendered tab", () => {
    for (const tab of ["primary", "inbound", "awaiting", "followup", "starred"] as const) {
      assert.equal(parseCategoryTabParam(tab), tab);
    }
  });

  it("rejects the unrendered sent tab, unknown values and non-strings", () => {
    assert.equal(parseCategoryTabParam("sent"), null);
    assert.equal(parseCategoryTabParam("everything"), null);
    assert.equal(parseCategoryTabParam(""), null);
    assert.equal(parseCategoryTabParam(undefined), null);
    assert.equal(parseCategoryTabParam(null), null);
    assert.equal(parseCategoryTabParam(["inbound"]), null);
  });
});

describe("tabForThreadStatus", () => {
  it("lands a fresh reply in Inbound and an in-flight follow-up in Awaiting", () => {
    assert.equal(tabForThreadStatus("replied"), "inbound");
    assert.equal(tabForThreadStatus("awaiting"), "awaiting");
  });

  it("fails open to Primary for anything else, so a deep link never strands a thread", () => {
    assert.equal(tabForThreadStatus("sent"), "primary");
    assert.equal(tabForThreadStatus("draft"), "primary");
    assert.equal(tabForThreadStatus(undefined), "primary");
    assert.equal(tabForThreadStatus(null), "primary");
    assert.equal(tabForThreadStatus("something-new"), "primary");
  });
});

describe("isClosedPipelineStatus", () => {
  it("closes won and dead deals", () => {
    assert.equal(isClosedPipelineStatus("converted"), true);
    assert.equal(isClosedPipelineStatus("hard_no"), true);
    assert.equal(isClosedPipelineStatus("soft_no"), true);
  });

  it("keeps live, parked and system-set states actionable", () => {
    for (const status of [
      "not_contacted",
      "initial_outreach_sent",
      "follow_up_sent",
      "responded",
      "future_potential",
      "loss_due_timing",
      "no_response",
    ]) {
      assert.equal(isClosedPipelineStatus(status), false);
    }
  });

  it("fails open on unknown and missing states", () => {
    assert.equal(isClosedPipelineStatus(null), false);
    assert.equal(isClosedPipelineStatus(undefined), false);
    assert.equal(isClosedPipelineStatus("a-future-status"), false);
  });
});

describe("isFollowUpExcludedPipelineStatus", () => {
  it("excludes closed and parked outcomes from Follow-up Due", () => {
    for (const status of [
      "converted",
      "hard_no",
      "soft_no",
      "future_potential",
      "loss_due_timing",
    ]) {
      assert.equal(isFollowUpExcludedPipelineStatus(status), true);
    }
  });

  it("keeps no_response follow-up-able, matching the dashboard engine", () => {
    for (const status of [
      "not_contacted",
      "initial_outreach_sent",
      "follow_up_sent",
      "responded",
      "no_response",
    ]) {
      assert.equal(isFollowUpExcludedPipelineStatus(status), false);
    }
  });

  it("fails open on unknown and missing states", () => {
    assert.equal(isFollowUpExcludedPipelineStatus(null), false);
    assert.equal(isFollowUpExcludedPipelineStatus(undefined), false);
  });
});
