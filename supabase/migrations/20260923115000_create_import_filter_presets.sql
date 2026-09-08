-- Migration: create_import_filter_presets
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" — a
--   small settings table, not an entity in the client graph.
-- Story: import criteria as data, not code.
--
-- A named, saved set of import filters — "Sheffield arts, any size" — so a
-- selection is something the team keeps and re-runs at the start of a cycle
-- rather than rebuilds from memory.
--
-- This is the *only* part of the charity register work that lives in Postgres.
-- The register itself — 171,800 charities and their filed accounts — is a
-- SQLite file built in CI and shipped with the deployment
-- (see docs/charity-register-import.md). Staging it in Postgres cost 570MB,
-- more than the entire Supabase free tier, and it competed for space with the
-- one thing that cannot be regenerated: sent emails and replies. A preset is a
-- few hundred bytes and is genuinely the team's own work, so it belongs here.
--
-- `filters` is validated in TypeScript (src/lib/charity-register/filters.ts)
-- rather than by a check constraint: the shape grows as the register offers more
-- to filter on, and a constraint here would need a migration every time a
-- control is added to the screen.
--
-- ACCESS: RLS enabled with no policies. Read and written only through Server
-- Actions holding the service-role client, after getCurrentActor has authorised
-- the caller — the same posture the register file has, for the same reason.
--
-- Schema change approval record (SOP §7):
--   Change        | 1 new table: IMPORT_FILTER_PRESETS.
--   Reason        | Saved import criteria, so a cycle's selection is repeatable.
--   Compatibility | Additive; nothing existing reads or writes it until the
--                 | import screen ships.
--   Data migration| None.
--   Security      | RLS enabled, no policies: service-role only. Holds filter
--                 | criteria, no personal data.
--   Documentation | Data Model tab "04 Entities" needs this table adding, then
--                 | npm run export:data-model.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260923115000_create_import_filter_presets.down.sql

create table if not exists public.import_filter_presets (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  filters            jsonb not null,
  source             text not null default 'charity_commission',
  created_by_user_id uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint import_filter_presets_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists import_filter_presets_name_key
  on public.import_filter_presets (source, lower(btrim(name)));

comment on table public.import_filter_presets is
  'Named, saved import criteria — "Sheffield arts, any size" — so a filter set is '
  'something the team keeps and re-runs rather than rebuilds from memory. The '
  'register those filters run against is a file shipped with the deployment, not '
  'a table. Read and written only through Server Actions.';

alter table public.import_filter_presets enable row level security;
revoke all on public.import_filter_presets from anon, authenticated;
