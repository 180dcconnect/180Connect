-- Rollback: create_entity_match_candidates

drop function if exists public.decide_duplicate_flag(uuid, boolean, text);

drop table if exists public.entity_match_candidates;
