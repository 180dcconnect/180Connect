-- Rollback for 20260820100200_add_usage_to_ai_generations.sql
-- Safe pre-merge only (see the migration header) — would discard real recorded
-- spend data if ever run after generations have actually happened.

alter table public.ai_generations
  drop constraint if exists ai_generations_tokens_non_negative,
  drop constraint if exists ai_generations_cost_non_negative,
  drop column if exists input_tokens,
  drop column if exists output_tokens,
  drop column if exists total_tokens,
  drop column if exists cost_usd;
