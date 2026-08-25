import assert from "node:assert/strict";
import test from "node:test";
import { generateStageTwoDraft, isStageTwoEligible } from "./stage-two-generation.ts";
import { buildStageTwoPrompt } from "./stage-two-prompt.ts";

const context = { organisationName: "Example Charity", organisationType: "charity" };

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

function okCallModel(text: string) {
  return async () => ({ text, usage });
}

test("only the sent-with-no-response pipeline state is eligible", () => {
  assert.equal(isStageTwoEligible("initial_outreach_sent"), true);
  for (const status of ["not_contacted", "follow_up_sent", "responded", "no_response", "converted"]) {
    assert.equal(isStageTwoEligible(status), false);
  }
});

test("generateStageTwoDraft returns a structured review draft with the model's usage", async () => {
  const result = await generateStageTwoDraft(
    "org-1",
    context,
    okCallModel(JSON.stringify({ subject: "Following up", body: "I wanted to follow up on my earlier email." })),
  );
  const expectedPrompt = buildStageTwoPrompt(context);
  assert.deepEqual(result, {
    draft: { subject: "Following up", body: "I wanted to follow up on my earlier email." },
    usage,
    prompt: { system: expectedPrompt.system, user: expectedPrompt.prompt },
  });
});

test("generateStageTwoDraft returns safe retry copy for model failures", async () => {
  const result = await generateStageTwoDraft("org-1", context, async () => { throw new Error("secret upstream detail"); });
  assert.deepEqual(result, { error: "The follow-up draft could not be generated. Try again." });
});
