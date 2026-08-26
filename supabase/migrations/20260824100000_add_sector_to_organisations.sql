-- Migration: add_sector_to_organisations
-- Story: Fix — /clients page_list selects organisations.sector and
--        organisations.sub_sector (42703 "column does not exist").
--
-- WHY THIS MIGRATION EXISTS: the Data Model (docs/data-model/04-entities.md,
-- ORGANISATIONS rows "sector" and "sub_sector") defines both columns on
-- ORGANISATIONS, and src/app/clients/page.tsx queries them, but no migration
-- ever added them to public.organisations — they only existed on
-- public.enrichment_results (20260804180000_create_org_children.sql). This is
-- the missing schema step.
--
-- Schema change approval record (SOP §7):
--   Change        | Add nullable sector and sub_sector text columns to
--                 | public.organisations.
--   Reason        | Align schema with the Data Model and unbreak the /clients
--                 | list query.
--   Compatibility | Additive only; existing queries are unaffected. Columns
--                 | are nullable with no default, so no backfill is required.
--                 | Population path is LLM classification (enrichment), per
--                 | the Data Model's Source column.
--   Data migration| None. Values start NULL and are filled by enrichment.
--   Security      | No new table, so no new RLS policies — column access is
--                 | governed by the table's existing policies (SELECT for
--                 | active users per docs/rls-permission-matrix.md). Both
--                 | columns are non-sensitive classifications.
--   Documentation | Data Model already lists both columns; no change needed.

alter table public.organisations
  add column if not exists sector     text,
  add column if not exists sub_sector text;
