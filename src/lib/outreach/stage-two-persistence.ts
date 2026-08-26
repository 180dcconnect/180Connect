// F101 Stage 2 persistence: builds the ai_generations insert payload for a
// follow-up generation. Kept pure and DB-free so a route-level regression —
// e.g. omitting the NOT NULL `model` column added by F113
// (20260831100000_add_model_to_ai_generations.sql), which fails every insert at
// runtime but never shows up in lib tests that mock the model call — is caught
// by a unit test instead of staging.

export type StageTwoGenerationInsert = {
  outreach_message_id: string;
  generated_subject: string;
  generated_body: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  prompt_system: string;
  prompt_user: string;
};

export function buildStageTwoGenerationInsert(input: {
  outreachMessageId: string;
  draft: { subject: string; body: string };
  model: string;
  usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  };
  costUsd: number | null;
  prompt: { system: string; user: string };
}): StageTwoGenerationInsert {
  return {
    outreach_message_id: input.outreachMessageId,
    generated_subject: input.draft.subject,
    generated_body: input.draft.body,
    // NOT NULL in ai_generations since F113: the model in force at generation
    // time, not a live lookup of the current default.
    model: input.model,
    input_tokens: input.usage.inputTokens ?? null,
    output_tokens: input.usage.outputTokens ?? null,
    total_tokens: input.usage.totalTokens ?? null,
    cost_usd: input.costUsd,
    // NOT NULL in ai_generations since F112 (20260901100000): the exact prompt
    // sent, stored verbatim per row. Omitting either column fails every real
    // insert at runtime — see this file's header for the F113 precedent that
    // makes the regression test below exist.
    prompt_system: input.prompt.system,
    prompt_user: input.prompt.user,
  };
}
