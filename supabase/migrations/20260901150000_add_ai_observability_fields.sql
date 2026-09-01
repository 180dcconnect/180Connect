-- Migration: add_ai_observability_fields
-- Adds explicit activity classification and provider usage/cost fields to every
-- persisted LLM generation so spend reporting never has to infer the activity.
-- Booklet rows may have null usage/cost until the provider/pricing data is available.

alter table public.ai_generations
  add column activity text not null default 'initial_email',
  add constraint ai_generations_activity_check
    check (activity in ('initial_email', 'follow_up_email', 'email_regeneration', 'other'));

alter table public.booklet_generations
  add column activity text not null default 'client_booklet',
  add column input_tokens integer,
  add column output_tokens integer,
  add column total_tokens integer,
  add column cost_usd numeric(12, 6),
  add constraint booklet_generations_activity_check
    check (activity = 'client_booklet'),
  add constraint booklet_generations_tokens_non_negative check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and (total_tokens is null or total_tokens >= 0)
  ),
  add constraint booklet_generations_cost_non_negative check (cost_usd is null or cost_usd >= 0);

comment on column public.ai_generations.activity is
  'Explicit AI work type: initial_email, follow_up_email, email_regeneration, or other.';
comment on column public.booklet_generations.activity is
  'Explicit AI work type. Currently client_booklet; retained for consistent reporting.';
comment on column public.booklet_generations.input_tokens is
  'Provider-reported input token count; null when unavailable.';
comment on column public.booklet_generations.output_tokens is
  'Provider-reported output token count; null when unavailable.';
comment on column public.booklet_generations.total_tokens is
  'Provider-reported total token count; null when unavailable.';
comment on column public.booklet_generations.cost_usd is
  'Snapshotted USD cost at generation time; null means unpriced, never free.';

create index ai_generations_activity_created_idx
  on public.ai_generations (activity, created_at desc);
create index booklet_generations_activity_created_idx
  on public.booklet_generations (activity, created_at desc);
