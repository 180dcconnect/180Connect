import assert from "node:assert/strict";
import test from "node:test";
import { generateStageTwoDraft, isStageTwoEligible } from "./stage-two-generation.ts";

const context = { organisationName: "Example Charity", organisationType: "charity" };

test("only the sent-with-no-response pipeline state is eligible", () => {
  assert.equal(isStageTwoEligible("initial_outreach_sent"), true);
  for (const status of ["not_contacted", "follow_up_sent", "responded", "no_response", "converted"]) {
    assert.equal(isStageTwoEligible(status), false);
  }
});

test("generateStageTwoDraft returns a structured review draft", async () => {
  const result = await generateStageTwoDraft("org-1", context, async () =>
    JSON.stringify({ subject: "Following up", body: "I wanted to follow up on my earlier email." }),
  );
  assert.deepEqual(result, { draft: { subject: "Following up", body: "I wanted to follow up on my earlier email." } });
});

test("generateStageTwoDraft returns safe retry copy for model failures", async () => {
  const result = await generateStageTwoDraft("org-1", context, async () => { throw new Error("secret upstream detail"); });
  assert.deepEqual(result, { error: "The follow-up draft could not be generated. Try again." });
});
