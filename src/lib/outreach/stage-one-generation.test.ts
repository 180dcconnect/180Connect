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

test("generateStageOneDraft forwards email length to prompt builder", async () => {
  const captured: { system: string; prompt: string }[] = [];
  const makeCallModel = () => async (input: { system: string; prompt: string }) => {
    captured.push(input);
    return JSON.stringify({ subject: "S", body: "B" });
  };

  await generateStageOneDraft("org-1", context, makeCallModel(), { length: "short" });
  assert.match(captured[0]!.system, /70 and 110 words/);

  captured.length = 0;
  await generateStageOneDraft("org-1", context, makeCallModel(), { length: "standard" });
  assert.match(captured[0]!.system, /120 and 180 words/);

  captured.length = 0;
  await generateStageOneDraft("org-1", context, makeCallModel(), { length: "detailed" });
  assert.match(captured[0]!.system, /190 and 260 words/);

  captured.length = 0;
  await generateStageOneDraft("org-1", context, makeCallModel());
  assert.match(captured[0]!.system, /120 and 180 words/);
});
