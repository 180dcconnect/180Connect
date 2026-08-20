-- Migration: add_prompt_to_ai_generations
-- F112 — Save AI Prompt and Output (#109). AC1: "every email generation call stores
-- the exact prompt sent and the exact output received". generated_subject/
-- generated_body (20260804190000) are already the exact output; this adds the other
-- half — the exact prompt.
--
-- NOT NULL, same reasoning as `model` (20260820100000): the prompt sent is
-- deterministic and always known at generation time, computed locally before the
-- model is ever called — there is no legitimate "we don't know what prompt was
-- sent" case the way there's a legitimate "we don't know the per-token rate" case
-- for cost_usd. Safe to add NOT NULL with no backfill for the same reason that
-- migration was: zero rows in any shared environment as of this migration (F100
-- hasn't merged anywhere yet).
--
-- Two columns, not one, because the model is actually sent a system instruction and
-- a separate user-turn prompt (CallStageOneModel's own {system, prompt} shape,
-- stage-one-generation.ts) — storing them separately mirrors exactly what was
-- transmitted, rather than an admin having to guess where a concatenated blob was
-- joined back together.
--
-- prompt_system happens to be a hardcoded constant today (stage-one-prompt.ts), but
-- is still captured per-row rather than reconstructed from current source at read
-- time — the same reasoning `model` already established: a future edit to that
-- constant must never silently rewrite what an older row says was actually sent.
--
-- Reversibility: paired rollback in ../rollback/20260820100400_add_prompt_to_ai_generations.down.sql

alter table public.ai_generations
  add column prompt_system text not null,
  add column prompt_user   text not null;

comment on column public.ai_generations.prompt_system is
  'The exact system instruction sent to the model for this generation (F112 AC1). '
  'Captured per-row even though it is a constant today, so a future edit to it '
  'never rewrites what an older row says was actually sent.';
comment on column public.ai_generations.prompt_user is
  'The exact user-turn prompt sent to the model for this generation (F112 AC1), '
  'built from the client context available at generation time.';
