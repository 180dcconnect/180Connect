import assert from "node:assert/strict";
import test from "node:test";
import { generateStageOneDraft } from "./stage-one-generation.ts";
import { buildStageOnePrompt } from "./stage-one-prompt.ts";

const context = { organisationName: "Example Charity", organisationType: "charity" };
const USAGE = { inputTokens: 120, outputTokens: 45, totalTokens: 165 };
// The exact wording is stage-one-prompt.test.ts's concern — this just needs the
// same shape generateStageOneDraft actually sends, to prove it comes back unchanged.
const EXPECTED_PROMPT = buildStageOnePrompt(context);

test("generateStageOneDraft returns a structured draft, the reported usage, and the exact prompt sent", async () => {
  const result = await generateStageOneDraft("org-1", context, async () => ({
    text: JSON.stringify({ subject: "Working together", body: "Hello, we would like to introduce 180DC." }),
    usage: USAGE,
  }));
  assert.deepEqual(result, {
    draft: { subject: "Working together", body: "Hello, we would like to introduce 180DC." },
    sizeTemplate: "default",
    usage: USAGE,
    prompt: { system: EXPECTED_PROMPT.system, user: EXPECTED_PROMPT.prompt },
  });
});

test("generateStageOneDraft reports the size template applied for the income band", async () => {
  const over1mContext = { ...context, incomeBand: "over_1m" } as const;
  const result = await generateStageOneDraft(
    "org-1",
    over1mContext,
    async () => ({
      text: JSON.stringify({ subject: "Working together", body: "Hello there." }),
      usage: USAGE,
    }),
  );
  const expectedPrompt = buildStageOnePrompt(over1mContext);
  assert.deepEqual(result, {
    draft: { subject: "Working together", body: "Hello there." },
    sizeTemplate: "over_1m",
    usage: USAGE,
    prompt: { system: expectedPrompt.system, user: expectedPrompt.prompt },
  });
});

test("generateStageOneDraft turns model failure into retryable user copy", async () => {
  const result = await generateStageOneDraft("org-1", context, async () => {
    throw new Error("secret upstream detail");
  });
  assert.deepEqual(result, { error: "The email draft could not be generated. Try again." });
});
test("generateStageOneDraft rejects an empty or malformed draft", async () => {
  const result = await generateStageOneDraft("org-1", context, async () => ({ text: "{}", usage: USAGE }));
  assert.deepEqual(result, { error: "The email draft could not be generated. Try again." });
});

test("generateStageOneDraft forwards email length to prompt builder", async () => {
  const captured: { system: string; prompt: string }[] = [];
  const makeCallModel = () => async (input: { system: string; prompt: string }) => {
    captured.push(input);
    return { text: JSON.stringify({ subject: "S", body: "B" }), usage: USAGE };
  };

  await generateStageOneDraft("org-1", context, makeCallModel(), { length: "short" });
  assert.match(captured[0]!.system, /70 and 100 words/);

  captured.length = 0;
  await generateStageOneDraft("org-1", context, makeCallModel(), { length: "standard" });
  assert.match(captured[0]!.system, /130 and 170 words/);

  captured.length = 0;
  await generateStageOneDraft("org-1", context, makeCallModel(), { length: "detailed" });
  assert.match(captured[0]!.system, /200 and 260 words/);

  captured.length = 0;
  await generateStageOneDraft("org-1", context, makeCallModel());
  assert.match(captured[0]!.system, /130 and 170 words/);
});

test("generateStageOneDraft passes through a provider that omitted usage data", async () => {
  const noUsage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined };
  const result = await generateStageOneDraft("org-1", context, async () => ({
    text: JSON.stringify({ subject: "Hi", body: "Hello." }),
    usage: noUsage,
  }));
  assert.deepEqual(result, {
    draft: { subject: "Hi", body: "Hello." },
    sizeTemplate: "default",
    usage: noUsage,
    prompt: { system: EXPECTED_PROMPT.system, user: EXPECTED_PROMPT.prompt },
  });
});
