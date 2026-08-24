import assert from "node:assert/strict";
import test from "node:test";
import { generateStageOneDraft } from "./stage-one-generation.ts";

const context = { organisationName: "Example Charity", organisationType: "charity" };

test("generateStageOneDraft returns a structured draft", async () => {
  const result = await generateStageOneDraft("org-1", context, async () =>
    JSON.stringify({ subject: "Working together", body: "Hello, we would like to introduce 180DC." }),
  );
  assert.deepEqual(result, {
    draft: { subject: "Working together", body: "Hello, we would like to introduce 180DC." },
    sizeTemplate: "default",
  });
});

test("generateStageOneDraft reports the size template applied for the income band", async () => {
  const result = await generateStageOneDraft(
    "org-1",
    { ...context, incomeBand: "over_1m" },
    async () => JSON.stringify({ subject: "Working together", body: "Hello there." }),
  );
  assert.deepEqual(result, {
    draft: { subject: "Working together", body: "Hello there." },
    sizeTemplate: "over_1m",
  });
});

test("generateStageOneDraft turns model failure into retryable user copy", async () => {
  const result = await generateStageOneDraft("org-1", context, async () => {
    throw new Error("secret upstream detail");
  });
  assert.deepEqual(result, { error: "The email draft could not be generated. Try again." });
});
test("generateStageOneDraft rejects an empty or malformed draft", async () => {
  const result = await generateStageOneDraft("org-1", context, async () => "{}");
  assert.deepEqual(result, { error: "The email draft could not be generated. Try again." });
});
