-- Migration: add_tone_to_ai_generations
-- Story: F209 Tone Performance (#204)
-- Spec: docs/rls-permission-matrix.md §"AI_GENERATIONS" (unchanged by this migration)
--
-- WHAT: two nullable columns on AI_GENERATIONS —
--   tone_register text  — F107's tone dial at generation time ('professional' | 'warm'
--                         | 'formal' | 'direct')
--   tone_length   text  — F107's length dial at generation time ('short' | 'standard'
--                         | 'detailed')
--
-- WHY STRUCTURED COLUMNS: F112 stores the exact prompt text, and tone is embedded
--   in that text — but analytics over prose means every reader re-parses the
--   register by string-matching 'Register: warm and encouraging…' against
--   REGISTER_INSTRUCTIONS wording that may be re-worded at any time. F209's AC1
--   needs rates *by tone setting*, which is a group-by, not a text search. The
--   route writes the dial it actually received at insert time — the same
--   write-once-at-generation rule F113 set for `model`, so a later rewording or
--   default change never rewrites history (F113's AC2 reasoning applies verbatim).
--
-- WHY NULLABLE, NOT NOT NULL: unlike F113's `model` column (added to a table with
--   zero rows — see that migration), AI_GENERATIONS on staging/production already
--   holds months of rows written before this migration. A not-null add would fail
--   on every existing row. NULL means "generated before tone was tracked or by a
--   route that does not choose tone" — exactly F209's AC3 population to exclude.
--
-- WHY THE BACKFILL READS PROMPT TEXT ANYWAY: rows already written cannot gain
--   structured values retroactively, but their prompts still state the register
--   verbatim ('Register: warm and encouraging while still professional.'), and the
--   length line likewise ('Length: 130 to 170 words…'). The backfill derives the
--   dial from that text using the same phrasing the generation code emits. This is
--   deliberately conservative: LIKE '%Register: <name>%' requires the label AND the
--   name, so a future rewording cannot half-match an old prompt. Prompt templates
--   are const strings per row, so each phrase matches whole rows atomically —
--   there is no partial-registration state to worry about. Length: the emitted
--   sentence is anchored on 'Length: ' and the dial is the token directly after
--   it ('70', '130', '200' → short/standard/detailed), so matching the first
--   number distinguishes the three ranges (they do not overlap). If a prompt
--   matches neither pattern, the column stays NULL and the row is excluded from
--   the analytics — the same treatment as pre-F112 rows.
--
--   The backfill's source-of-truth caveat is recorded in the column comments: it
--   reflects what the prompt said, which for these rows IS what the CAM chose —
--   the prompt is built directly from the request's dial (buildStageOnePrompt's
--   REGISTER_INSTRUCTIONS[register] / LENGTH_INSTRUCTIONS[length]).
--
-- Security: no RLS change. AI_GENERATIONS grants SELECT to every active user and
--   no INSERT/UPDATE/DELETE to authenticated (writes are service-role only,
--   matrix §"AI_GENERATIONS") — new columns on an existing table inherit the
--   table's existing policies. The UPDATE inside the backfill runs as the
--   migration (superuser) and never again.
--
-- Schema change approval record (SOP §7):
--   Change         | Add AI_GENERATIONS.tone_register, AI_GENERATIONS.tone_length
--                  | (both text, nullable) + one-off backfill.
--   Reason         | F209 — conversion/response rates broken down by tone setting
--                  | need the setting as data, not as prompt prose (#204 AC1/AC3).
--   Compatibility  | Additive, nullable columns; all existing readers unaffected.
--   Data migration | One-off backfill from prompt text (see above); idempotent —
--                  | re-running updates only NULL rows.
--   Security       | None (see above).
--   Documentation  | Data Model tab 04 + tab 02 — this column rides with the same
--                  | pending spreadsheet sign-off as the rest of AI_GENERATIONS
--                  | (see 20260831100000_add_model_to_ai_generations.sql).
--
-- Reversibility: paired rollback in
--   ../rollback/20260925100000_add_tone_to_ai_generations.down.sql

alter table public.ai_generations
  add column tone_register text;

alter table public.ai_generations
  add column tone_length text;

comment on column public.ai_generations.tone_register is
  'F209: the F107 tone dial this generation ran with (professional|warm|formal|direct). '
  'Written once at insert time by the generating route; rows before this migration are '
  'backfilled from their stored prompt text (REGISTER_INSTRUCTIONS phrasing), so a '
  'backfilled value reflects what the prompt instructed rather than a request field. '
  'Null = tone was not chosen or predates tracking; excluded from tone analytics (AC3).';

comment on column public.ai_generations.tone_length is
  'F209: the F107 length dial this generation ran with (short|standard|detailed). '
  'Same write-once and prompt-backfill provenance as tone_register.';

-- One-off backfill. The patterns mirror the exact sentences stage-one-prompt.ts
-- emits; the WHERE clause re-checks the same condition each UPDATE filters on, so
-- the statement is a no-op on rows it cannot classify.
update public.ai_generations
set tone_register = case
      when prompt_system like '%Register: professional%' then 'professional'
      when prompt_system like '%Register: warm%' then 'warm'
      when prompt_system like '%Register: formal%' then 'formal'
      when prompt_system like '%Register: direct%' then 'direct'
      else null
    end,
    tone_length = case
      when prompt_system like '%Length: 70 to 100 words%' then 'short'
      when prompt_system like '%Length: 130 to 170 words%' then 'standard'
      when prompt_system like '%Length: 200 to 260 words%' then 'detailed'
      else null
    end
where prompt_system is not null
  and (prompt_system like '%Register: %' or prompt_system like '%Length: %');

-- The generation routes group and filter on these columns (F209's card reads them
-- per-CAM); a btree on each keeps that off a sequential scan as the table grows.
create index ai_generations_tone_register_idx on public.ai_generations (tone_register);
create index ai_generations_tone_length_idx on public.ai_generations (tone_length);
