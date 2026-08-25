-- Migration: add_prompt_to_ai_generations
-- Sequence: fix-forward on step 11 (20260804190000_create_outreach.sql), same as
--   20260831100000/20260831100200 (F113/F213's re-dated model/usage migrations).
--   Originally 20260820100400; re-dated past dev's newest (20260831200000) so the
--   order check stays green.
-- Story: F112 Save AI Prompt and Output (#109). AC1: "every email generation call
--   stores the exact prompt sent and the exact output received".
--   generated_subject/generated_body are already the exact output; this adds the
--   other half — the exact prompt.
-- Spec: docs/rls-permission-matrix.md §"AI_GENERATIONS" (unchanged by this migration)
--
-- WHY TWO COLUMNS, NOT ONE: the model is actually sent a system instruction and a
--   separate user-turn prompt (CallStageOneModel's own {system, prompt} shape,
--   stage-one-generation.ts) — storing them separately mirrors exactly what was
--   transmitted, rather than an admin having to guess where a concatenated blob
--   was joined back together.
--
-- WHY NOT NULL WITH NO DEFAULT IS SAFE: the prompt sent is deterministic and
--   always known at generation time, computed locally before the model is ever
--   called — there is no legitimate "we don't know what prompt was sent" case the
--   way there's a legitimate "we don't know the per-token rate" case for cost_usd.
--   Zero rows in any shared environment as of this migration, for the reasons
--   20260820100000's header already sets out (F100 hadn't merged anywhere).
--
-- prompt_system happens to be a hardcoded constant today (stage-one-prompt.ts),
--   but is still captured per-row rather than reconstructed from current source at
--   read time — the same reasoning `model` established: a future edit to that
--   constant must never silently rewrite what an older row says was actually sent.
--
-- Schema change approval record (SOP §7):
--   Change        | Add AI_GENERATIONS.prompt_system, prompt_user (text, not null).
--   Reason        | F112 AC1 — every generation call stores the exact prompt sent,
--                 | so admins can audit why the model wrote what it wrote (#109).
--   Compatibility | Additive columns on a table with zero rows in any shared
--                 | environment (see above) — not null is safe, nothing to backfill.
--   Data migration| None.
--   Security      | No RLS change — inherits the table's existing policies. Note:
--                 | prompts carry client context and the table's SELECT policy is
--                 | open to every active user; flagged for the privacy/retention
--                 | discussion on #109 rather than changed here.
--   Documentation | Data Model tab 04 + tab 02 — rides along with the same
--                 | pending-spreadsheet-signoff item AI_GENERATIONS itself and its
--                 | model/usage columns are already flagged under.
--
-- Reversibility: paired rollback in
--   ../rollback/20260901100000_add_prompt_to_ai_generations.down.sql

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
