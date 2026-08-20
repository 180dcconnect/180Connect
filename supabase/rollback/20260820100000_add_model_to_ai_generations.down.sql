-- Rollback for 20260820100000_add_model_to_ai_generations.sql
-- Drops AI_GENERATIONS.model. Safe pre-merge (see the migration header: zero rows
-- in any shared environment as of this migration) — would silently discard real
-- data if ever run after F100/F113 have actually been generating drafts.

alter table public.ai_generations
  drop column model;
