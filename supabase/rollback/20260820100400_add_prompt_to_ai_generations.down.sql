-- Rollback for 20260820100400_add_prompt_to_ai_generations.sql
-- Drops AI_GENERATIONS.prompt_system and .prompt_user. Safe pre-merge (see the
-- migration header: zero rows in any shared environment as of this migration) —
-- would silently discard real data if ever run after F100/F111/F112 have actually
-- been generating drafts.

alter table public.ai_generations
  drop column prompt_system,
  drop column prompt_user;
