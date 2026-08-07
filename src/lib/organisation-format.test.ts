import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PIPELINE_STATUSES } from "./organisation-format.ts";

describe("PIPELINE_STATUSES", () => {
  it("has exactly the ten F146-F155 values, not_contacted first", () => {
    assert.deepEqual(PIPELINE_STATUSES, [
      "not_contacted",
      "initial_outreach_sent",
      "follow_up_sent",
      "responded",
      "converted",
      "future_potential",
      "soft_no",
      "hard_no",
      "no_response",
      "loss_due_timing",
    ]);
  });
});
