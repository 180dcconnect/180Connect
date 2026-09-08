-- Migration: add_ai_observability_fields
-- Adds an explicit activity classification to every persisted LLM generation so
-- spend reporting never has to infer the activity.
--
-- The provider usage/cost columns (input_tokens/output_tokens/total_tokens/
-- cost_usd and their non-negative constraints) already exist on both tables and
-- are NOT re-added here: booklet_generations has had them since its creation
-- (20260822130000_create_booklet_generations.sql) and ai_generations since
-- 20260831100200_add_usage_to_ai_generations.sql. Re-adding them on a fresh
-- apply fails with duplicate column/constraint errors.

alter table public.ai_generations
  add column activity text not null default 'initial_email',
  add constraint ai_generations_activity_check
    check (activity in ('initial_email', 'follow_up_email', 'email_regeneration', 'other'));

alter table public.booklet_generations
  add column activity text not null default 'client_booklet',
  add constraint booklet_generations_activity_check
    check (activity = 'client_booklet');

comment on column public.ai_generations.activity is
  'Explicit AI work type: initial_email, follow_up_email, email_regeneration, or other.';
comment on column public.booklet_generations.activity is
  'Explicit AI work type. Currently client_booklet; retained for consistent reporting.';

create index ai_generations_activity_created_idx
  on public.ai_generations (activity, created_at desc);
create index booklet_generations_activity_created_idx
  on public.booklet_generations (activity, created_at desc);
