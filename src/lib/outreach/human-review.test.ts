import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { humanReviewDecision, type OutreachStage } from "./human-review.ts";

describe("F121/F250 human review checkpoint", () => {
  for (const stage of ["stage_one", "stage_two", "scheduled", "recurring"] as const satisfies readonly OutreachStage[]) {
    it(`blocks ${stage} without explicit approval`, () => assert.deepEqual(humanReviewDecision(stage, false), { allowed: false, message: "Review the email and confirm approval before sending." }));
  }
  it("allows a deliberately approved email", () => assert.deepEqual(humanReviewDecision("stage_one", true), { allowed: true, stage: "stage_one" }));
});
