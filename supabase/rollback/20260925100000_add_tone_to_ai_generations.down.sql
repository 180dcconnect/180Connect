-- Rollback: add_tone_to_ai_generations (F209)
--
-- Drops the tone columns and their indexes. The backfilled values are derived
-- data (re-derivable from prompt text by the forward migration's UPDATE), so
-- nothing irreplaceable is lost. Routes that write the columns must be deployed
-- out before this runs, or their inserts will reference missing columns.

drop index if exists public.ai_generations_tone_length_idx;
drop index if exists public.ai_generations_tone_register_idx;

comment on column public.ai_generations.tone_length is null;
comment on column public.ai_generations.tone_register is null;

alter table public.ai_generations
  drop column if exists tone_length;

alter table public.ai_generations
  drop column if exists tone_register;
