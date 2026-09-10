-- Rollback for 20260923101000_add_ai_observability_fields.sql.
--
-- Drops only what that migration adds — the activity column/check and the
-- activity indexes. input_tokens/output_tokens/total_tokens/cost_usd and their
-- non-negative constraints belong to earlier migrations (booklet_generations:
-- 20260822130000_create_booklet_generations.sql; ai_generations:
-- 20260831100200_add_usage_to_ai_generations.sql) and are NOT dropped here.

drop index if exists public.ai_generations_activity_created_idx;
drop index if exists public.booklet_generations_activity_created_idx;

alter table public.ai_generations
  drop constraint if exists ai_generations_activity_check,
  drop column if exists activity;

alter table public.booklet_generations
  drop constraint if exists booklet_generations_activity_check,
  drop column if exists activity;
