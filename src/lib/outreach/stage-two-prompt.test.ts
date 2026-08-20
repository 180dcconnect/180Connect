import assert from "node:assert/strict";
import test from "node:test";
import { buildStageTwoPrompt } from "./stage-two-prompt.ts";

test("Stage 2 prompt requires an acknowledgement and includes Stage 1 and booklet context", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    booklet: "Reviewed booklet insight",
    previousSubject: "Could we help?",
    previousBody: "Our original introduction",
  });
  assert.match(result.system, /acknowledge the previous email/i);
  assert.match(result.system, /do not write a fresh cold open/i);
  assert.match(result.prompt, /Reviewed booklet insight/);
  assert.match(result.prompt, /Our original introduction/);
});

test("Stage 2 prompt only exposes a live news hook when enabled", () => {
  const context = { organisationName: "Example", organisationType: "charity", newsHooks: ["New programme launched"] };
  assert.doesNotMatch(buildStageTwoPrompt(context).prompt, /New programme launched/);
  assert.match(buildStageTwoPrompt(context, { newsEnabled: true }).prompt, /New programme launched/);
});
