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

test("reply follow-up uses the actual reply and asks the model to answer it", () => {
  const result = buildStageTwoPrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    previousSubject: "Consulting support",
    previousBody: "Could we arrange an introduction?",
    replyBody: "Thanks. What would a typical project cost us?",
  });

  assert.match(result.system, /direct response to a client's reply/i);
  assert.match(result.system, /address what the client actually asked/i);
  assert.doesNotMatch(result.system, /initial email received no response/i);
  assert.match(result.prompt, /What would a typical project cost us\?/);
  assert.match(result.prompt, /If it contains a question, address it/i);
});
