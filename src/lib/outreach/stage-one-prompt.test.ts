import assert from "node:assert/strict";
import test from "node:test";
import { buildStageOnePrompt } from "./stage-one-prompt.ts";

test("buildStageOnePrompt includes real profile and booklet context", () => {
  const result = buildStageOnePrompt({
    organisationName: "Example Charity",
    organisationType: "charity",
    contactName: "Alex Smith",
    missionStatement: "Supports young carers",
    missionKeywords: ["young people", "care"],
    newsHooks: ["Opened a new support centre"],
  });
  assert.match(result.prompt, /Example Charity/);
  assert.match(result.prompt, /Alex Smith/);
  assert.match(result.prompt, /Supports young carers/);
  assert.match(result.prompt, /Opened a new support centre/);
  assert.match(result.system, /Never invent/);
});

test("buildStageOnePrompt handles missing optional context", () => {
  const result = buildStageOnePrompt({
    organisationName: "Sparse Charity",
    organisationType: "charity",
  });
  assert.match(result.prompt, /Sparse Charity/);
  assert.match(result.prompt, /Not provided/);
  assert.match(result.prompt, /do not mention that data is missing/i);
});
