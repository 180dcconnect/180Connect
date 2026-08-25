import assert from "node:assert/strict";
import test from "node:test";
import { buildStageTwoGenerationInsert } from "./stage-two-persistence.ts";

// Route-level regression guard for the ai_generations insert the Stage 2 route
// performs. The schema (20260831100000_add_model_to_ai_generations.sql) requires
// model NOT NULL; F213 adds the token/cost columns; F112
// (20260901100000_add_prompt_to_ai_generations.sql) adds prompt_system/prompt_user
// NOT NULL. A payload missing any of these fails every real insert at runtime —
// a failure lib-level generation tests (which mock the model call and never touch
// the DB) cannot surface. This is not hypothetical: F113's model column broke
// Stage 2 exactly this way, and F112's columns would have done it again had the
// insert builder not been updated in the same PR.

function buildPayload() {
  return buildStageTwoGenerationInsert({
    outreachMessageId: "msg-1",
    draft: { subject: "Following up", body: "Checking back on my earlier email." },
    model: "gemini-2.0-flash",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    costUsd: 0.000123,
    prompt: {
      system: "You draft Stage 2 follow-up outreach emails.",
      user: "Draft a follow-up email using this context.\n\nOrganisation: Example Charity",
    },
  });
}

test("persistence payload always carries every NOT NULL column", () => {
  const payload = buildPayload();
  // Every column the migrations declare NOT NULL with no default — a missing or
  // blank one is a guaranteed runtime NOT NULL violation on the real table.
  assert.equal(payload.model, "gemini-2.0-flash");
  assert.ok(payload.model.trim().length > 0);
  assert.ok(payload.prompt_system.trim().length > 0);
  assert.ok(payload.prompt_user.trim().length > 0);
  assert.equal(payload.outreach_message_id, "msg-1");
  assert.equal(payload.generated_subject, "Following up");
  assert.equal(payload.generated_body, "Checking back on my earlier email.");
  assert.deepEqual(
    [payload.input_tokens, payload.output_tokens, payload.total_tokens],
    [100, 50, 150],
  );
  assert.equal(payload.cost_usd, 0.000123);
});

test("the stored prompt is the exact system/user pair that was sent", () => {
  const payload = buildPayload();
  assert.equal(payload.prompt_system, "You draft Stage 2 follow-up outreach emails.");
  assert.equal(
    payload.prompt_user,
    "Draft a follow-up email using this context.\n\nOrganisation: Example Charity",
  );
});

test("absent usage counts and unknown pricing store nulls, never fabricated zeros", () => {
  const payload = buildStageTwoGenerationInsert({
    outreachMessageId: "msg-2",
    draft: { subject: "S", body: "B" },
    model: "gemini-2.0-flash",
    usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
    costUsd: null,
    prompt: { system: "system", user: "user" },
  });
  assert.equal(payload.input_tokens, null);
  assert.equal(payload.output_tokens, null);
  assert.equal(payload.total_tokens, null);
  assert.equal(payload.cost_usd, null);
});
