-- Migration: import_filter_presets_upsert_key
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" —
--   a fix to the settings table added in 20260915090000.
-- Story: saving a filter set actually saves it.
--
-- IMPORT_FILTER_PRESETS shipped with its uniqueness expressed as an *expression*
-- index, `(source, lower(btrim(name)))`. That is the right rule — "Sheffield
-- arts" and "sheffield arts " are the same set, and the team types names by
-- hand — but Postgres cannot match `ON CONFLICT (source, name)` to an
-- expression index, so every save from the import screen failed with
--
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
--
-- and the table has stayed empty since it was created. The conflict target has
-- to name columns, so the normalisation moves out of the index and into a
-- stored generated column the index can be built on plainly.
--
-- `name` keeps whatever case the person typed — it is what the chip shows.
-- `name_key` is the identity, so re-saving under a differently-cased name
-- replaces the set rather than quietly creating a second one beside it.
--
-- Schema change approval record (SOP §7):
--   Change        | 1 generated column on IMPORT_FILTER_PRESETS (name_key);
--                 | expression unique index replaced by a plain one over
--                 | (source, name_key).
--   Reason        | ON CONFLICT cannot target an expression index — saving a
--                 | filter set failed 100% of the time.
--   Compatibility | Additive. The uniqueness rule is unchanged in meaning, so
--                 | no existing row can violate the new index (and there are
--                 | none: the table is empty on every environment).
--   Data migration| None — name_key is generated for existing rows.
--   Security      | Unchanged: RLS on, no policies, service-role only.
--   Documentation | Data Model tab "04 Entities" gains name_key, then
--                 | npm run export:data-model.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260916120000_import_filter_presets_upsert_key.down.sql

alter table public.import_filter_presets
  add column if not exists name_key text
  generated always as (lower(btrim(name))) stored;

comment on column public.import_filter_presets.name_key is
  'Normalised name, the row identity for upserts. Generated — never written by '
  'the application. `name` holds the typed casing and is what the screen shows.';

drop index if exists public.import_filter_presets_name_key;

create unique index if not exists import_filter_presets_source_name_key
  on public.import_filter_presets (source, name_key);
