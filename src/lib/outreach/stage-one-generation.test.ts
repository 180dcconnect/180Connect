import assert from "node:assert/strict";
import test from "node:test";
import { generateStageOneDraft } from "./stage-one-generation.ts";

const context = { organisationName: "Example Charity", organisationType: "charity" };
const USAGE = { inputTokens: 120, outputTokens: 45, totalTokens: 165 };

test("generateStageOneDraft returns a structured draft and the reported usage", async () => {
  const result = await generateStageOneDraft("org-1", context, async () => ({
    text: JSON.stringify({ subject: "Working together", body: "Hello, we would like to introduce 180DC." }),
    usage: USAGE,
  }));
  assert.deepEqual(result, {
    draft: { subject: "Working together", body: "Hello, we would like to introduce 180DC." },
    usage: USAGE,
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

test("generateStageOneDraft passes through a provider that omitted usage data", async () => {
  const noUsage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined };
  const result = await generateStageOneDraft("org-1", context, async () => ({
    text: JSON.stringify({ subject: "Hi", body: "Hello." }),
    usage: noUsage,
  }));
  assert.deepEqual(result, { draft: { subject: "Hi", body: "Hello." }, usage: noUsage });
});
