-- Rollback: create_potential_duplicates

drop function if exists public.decide_duplicate_flag(uuid, boolean, text);

drop table if exists public.potential_duplicates;
