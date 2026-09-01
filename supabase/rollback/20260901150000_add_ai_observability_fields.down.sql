drop index if exists public.ai_generations_activity_created_idx;
drop index if exists public.booklet_generations_activity_created_idx;

alter table public.ai_generations
  drop constraint if exists ai_generations_activity_check,
  drop column if exists activity;

alter table public.booklet_generations
  drop constraint if exists booklet_generations_activity_check,
  drop constraint if exists booklet_generations_tokens_non_negative,
  drop constraint if exists booklet_generations_cost_non_negative,
  drop column if exists activity,
  drop column if exists input_tokens,
  drop column if exists output_tokens,
  drop column if exists total_tokens,
  drop column if exists cost_usd;
