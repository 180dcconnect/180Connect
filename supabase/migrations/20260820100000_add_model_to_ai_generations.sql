-- Migration: add_model_to_ai_generations
-- Sequence: fix-forward on step 11 (20260804190000_create_outreach.sql), which
--   created AI_GENERATIONS without a model column. That migration is already
--   applied to staging, so it is not edited (MIGRATIONS.md: never edit an applied
--   migration).
-- Story: F113 Track Model Used (#110)
-- Spec: docs/rls-permission-matrix.md §"AI_GENERATIONS" (unchanged by this migration)
--
-- WHY NOT NULL WITH NO DEFAULT IS SAFE: AI_GENERATIONS has exactly one writer —
--   the stage-one generation route (src/app/api/clients/[id]/outreach-drafts/stage-one),
--   which lands with F100 (#99, still an open PR as of this migration). No shared
--   environment has ever run that code, so AI_GENERATIONS has zero rows anywhere
--   this migration will apply. A `not null` add is only ever a hard failure against
--   existing rows with no value to backfill — there are none.
--
-- WHY THIS ROW, NOT A NEW TABLE: F113's own AC1 is explicit that the model belongs
--   on "each stored generation record (F112)" — i.e. this table — not a side table
--   keyed off it. AC2 (historical rows must keep showing the model actually used,
--   not today's default) is satisfied by writing the value once at insert time
--   (see the route change in this same PR) rather than deriving it live from
--   GEMINI_MODEL on read.
--
-- Schema change approval record (SOP §7):
--   Change        | Add AI_GENERATIONS.model (text, not null).
--   Reason        | F113 — record which AI model produced each draft, so admins can
--                 | filter/group past generations by model (#110 AC1/AC3).
--   Compatibility | Additive column on a table with no rows in any shared
--                 | environment (see above) — not null is safe, nothing to backfill.
--   Data migration| None.
--   Security      | No RLS change. AI_GENERATIONS already grants SELECT to every
--                 | active user and no INSERT/UPDATE/DELETE to authenticated (writes
--                 | are service-role only, matrix §"AI_GENERATIONS") — a new column
--                 | on an existing table inherits the table's existing policies.
--   Documentation | Data Model tab 04 + tab 02 — not yet applied; AI_GENERATIONS
--                 | itself predates this migration and was already flagged as
--                 | pending spreadsheet sign-off when F100 introduced it (see that
--                 | PR). This column rides along with the same open item, not a
--                 | new one.
--
-- Reversibility: paired rollback in
--   ../rollback/20260820100000_add_model_to_ai_generations.down.sql

alter table public.ai_generations
  add column model text not null;

comment on column public.ai_generations.model is
  'F113: the exact model id (GEMINI_MODEL at the time) that produced this generation. '
  'Written once at insert time — never re-derived from the current env value on read, '
  'so a later model change does not rewrite what history says actually ran (AC2).';
