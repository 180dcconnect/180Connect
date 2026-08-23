import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { buildStageOnePrompt, EMAIL_LENGTHS } from "./stage-one-prompt.ts";

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

test("buildStageOnePrompt applies each selected email length", () => {
  const context = { organisationName: "Example", organisationType: "charity" };
  assert.match(buildStageOnePrompt(context, { length: "short" }).system, /70 and 100 words/);
  assert.match(buildStageOnePrompt(context, { length: "standard" }).system, /130 and 170 words/);
  assert.match(buildStageOnePrompt(context, { length: "detailed" }).system, /200 and 260 words/);
});

test("buildStageOnePrompt defaults to standard when length is omitted", () => {
  const context = { organisationName: "Example", organisationType: "charity" };
  assert.match(buildStageOnePrompt(context).system, /130 and 170 words/);
  assert.match(buildStageOnePrompt(context, {}).system, /130 and 170 words/);
});

test("email length validation rejects invalid values (route returns 400)", () => {
  const schema = z.object({ length: z.enum(EMAIL_LENGTHS).default("standard") });
  assert.equal(schema.safeParse({ length: "invalid" }).success, false);
  assert.equal(schema.safeParse({ length: "" }).success, false);
  assert.equal(schema.safeParse({ length: "SHORT" }).success, false);
  assert.equal(schema.safeParse({ length: "short" }).success, true);
  assert.equal(schema.safeParse({ length: "standard" }).success, true);
  assert.equal(schema.safeParse({ length: "detailed" }).success, true);
  assert.equal(schema.safeParse({}).success, true);
  assert.equal(schema.safeParse({}).data?.length, "standard");
});
