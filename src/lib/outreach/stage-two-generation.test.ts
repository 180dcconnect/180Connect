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
    draft: { body: "I wanted to follow up on my earlier email." },
    usage,
    prompt: { system: expectedPrompt.system, user: expectedPrompt.prompt },
  });
});

test("generateStageTwoDraft returns safe retry copy for model failures", async () => {
  const result = await generateStageTwoDraft("org-1", context, async () => { throw new Error("secret upstream detail"); });
  assert.deepEqual(result, { error: "The follow-up draft could not be generated. Try again." });
});

test("generateStageTwoDraft retries once when the first sample is truncated, then succeeds", async () => {
  // The exact provider cut from production: output ends mid-string.
  const truncated = '{"subject": "Following up", "body": "I wanted to follo';
  const valid = JSON.stringify({ subject: "Following up", body: "I wanted to follow up on my earlier email." });
  const texts = [truncated, valid];
  let calls = 0;
  const result = await generateStageTwoDraft("org-1", context, async () => {
    calls += 1;
    return { text: texts[Math.min(calls - 1, texts.length - 1)]!, usage };
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, {
    draft: { body: "I wanted to follow up on my earlier email." },
    usage,
    prompt: { system: buildStageTwoPrompt(context).system, user: buildStageTwoPrompt(context).prompt },
  });
});

test("generateStageTwoDraft fails after two unparseable samples, without looping", async () => {
  let calls = 0;
  const result = await generateStageTwoDraft("org-1", context, async () => {
    calls += 1;
    return { text: '{"subject": "Following up", "body": "cut off', usage };
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { error: "The follow-up draft could not be generated. Try again." });
});

test("a subject the model volunteers anyway is ignored, not an error", async () => {
  // "We do not ask for one" has to mean the key is dropped, not that an
  // otherwise good draft is thrown away — the retry budget is for truncation.
  let calls = 0;
  const result = await generateStageTwoDraft(
    "org-1",
    context,
    async () => {
      calls += 1;
      return { text: JSON.stringify({ subject: "Re: Partnership", body: "Happy to talk this week." }), usage };
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    draft: { body: "Happy to talk this week." },
    usage,
    prompt: { system: buildStageTwoPrompt(context).system, user: buildStageTwoPrompt(context).prompt },
  });
  assert.equal("subject" in (result as { draft: object }).draft, false);
});

test("a body-less sample fails rather than shipping an empty reply", async () => {
  let calls = 0;
  const result = await generateStageTwoDraft("org-1", context, async () => {
    calls += 1;
    return { text: JSON.stringify({ subject: "Re: Partnership" }), usage };
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { error: "The follow-up draft could not be generated. Try again." });
});

test("generateStageTwoDraft parses drafts wrapped in fences and chatter without retrying", async () => {
  let calls = 0;
  const wrapped = `Here is your draft:\n\`\`\`json\n${JSON.stringify({ subject: "Quick hello", body: "Just checking in." })}\n\`\`\`\nLet me know if you want tweaks.`;
  const result = await generateStageTwoDraft("org-1", context, async () => {
    calls += 1;
    return { text: wrapped, usage };
  });
  assert.equal(calls, 1);
  assert.deepEqual((result as { draft: unknown }).draft, { body: "Just checking in." });
});
