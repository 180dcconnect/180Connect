-- Migration: add_usage_to_ai_generations
-- Sequence: fix-forward on step 11 (20260804190000_create_outreach.sql).
-- Story: F213 LLM Cost Tracking (#208), building on F113 (#110)
-- Spec: docs/rls-permission-matrix.md §"AI_GENERATIONS" (unchanged by this migration)
--
-- WHY NULLABLE, UNLIKE model (20260820100000): F213 AC3 — "cost tracking failing
--   does not stop CAMs from generating emails." The Gemini call itself can succeed
--   while usage/pricing is unavailable (a provider that omits usage stats, or a
--   model with no configured MODEL_PRICING row yet — see the next migration). A
--   `not null` column would force a fabricated 0 into real financial data every
--   time that happens, which is worse than an honest "unknown". model stayed
--   not null because AC1 for F113 treats it as always knowable (it's a static env
--   value, not an external API's response); the token/cost figures below are not.
--
-- Schema change approval record (SOP §7):
--   Change        | Add AI_GENERATIONS.input_tokens, output_tokens, total_tokens
--                 | (integer, nullable) and cost_usd (numeric(12,6), nullable).
--   Reason        | F213 AC1 — every generation call has its associated cost or
--                 | token usage recorded, so admin spend can be tracked (#208).
--   Compatibility | Additive, nullable columns on a table with zero rows in any
--                 | shared environment (see 20260820100000's own header for why
--                 | that's true) — no backfill needed either way.
--   Data migration| None.
--   Security      | No RLS change — inherits the table's existing policies.
--   Documentation | Data Model tab 04 + tab 02 — rides along with the same
--                 | pending-spreadsheet-signoff item AI_GENERATIONS itself and
--                 | its model column are already flagged under.
--
-- Reversibility: paired rollback in
--   ../rollback/20260820100200_add_usage_to_ai_generations.down.sql

alter table public.ai_generations
  add column input_tokens  integer,
  add column output_tokens integer,
  add column total_tokens  integer,
  add column cost_usd      numeric(12, 6),
  add constraint ai_generations_tokens_non_negative
    check (
      (input_tokens is null or input_tokens >= 0)
      and (output_tokens is null or output_tokens >= 0)
      and (total_tokens is null or total_tokens >= 0)
    ),
  add constraint ai_generations_cost_non_negative
    check (cost_usd is null or cost_usd >= 0);

comment on column public.ai_generations.input_tokens is
  'F213: prompt tokens the provider reported for this call. Null when the provider '
  'omitted usage data — never fabricated as 0, which would understate real spend.';
comment on column public.ai_generations.output_tokens is
  'F213: completion tokens the provider reported for this call. Same null-not-zero '
  'reasoning as input_tokens.';
comment on column public.ai_generations.total_tokens is
  'F213: input_tokens + output_tokens as the provider reported it (may differ '
  'slightly from the sum if the provider counts something else, e.g. cached tokens '
  '— stored as its own field rather than always recomputed, so this stays true to '
  'what the provider actually said).';
comment on column public.ai_generations.cost_usd is
  'F213: input/output tokens priced against MODEL_PRICING at generation time, '
  'snapshotted the same way model already is — a later rate change must not rewrite '
  'what an old generation is recorded as having cost. Null when no MODEL_PRICING row '
  'exists yet for this model, not 0 — an unpriced model is unknown cost, not free.';
