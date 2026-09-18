-- Migration: create_outreach_cycles
-- Story: Outreach cycles — named stretches of time ("Spring 26") that analytics
--   compares ("how did we do spring versus autumn").
--
-- WHAT A CYCLE IS (AND IS NOT):
--   A cycle is a name over a date range, nothing more. No row is ever stamped
--   with a cycle: membership is derived at read time ("event date inside the
--   range"), so defining Autumn 25 tomorrow sorts all of history with no
--   backfill, and moving a cycle's dates simply re-labels. The one rule is
--   non-overlap (enforced in the app, refused in plain words): every email
--   belongs to exactly one cycle, or comparisons stop adding up.
--
-- SCHEMA CHANGE APPROVAL RECORD — DEVIATION, NOT YET MIRRORED (SOP §7):
--   The Data Model spreadsheet governs the schema, but this table is new and
--   the spreadsheet cannot be edited from this repo — same standing as
--   CLIENT_BOOKLETS (flagged in 20260827000001/20260828000000, still pending).
--   Change        | Add OUTREACH_CYCLES (new table)
--   Reason        | Named date ranges for cycle-over-cycle analytics
--   Compatibility | New table. Nothing existing reads or writes it.
--   Data migration| None.
--   Security      | RLS on, policies in this migration. Shared read (every
--                 | active user — a cycle is a name and two dates, no personal
--                 | data); writes admin-only, matching the
--                 | platform-settings:manage gate on the settings screen.
--   Documentation | Data Model spreadsheet pending (new entry).
--
-- Reversibility: paired rollback in ../rollback/20261004200000_create_outreach_cycles.down.sql

create table public.outreach_cycles (
  id                    uuid primary key default gen_random_uuid(),
  -- "Spring 26". Uniqueness is case- and whitespace-insensitive (name_key),
  -- so "spring 26" cannot sit beside "Spring 26" — same rule as
  -- import_filter_presets' (source, name_key).
  name                  text not null,
  name_key              text generated always as (lower(btrim(name))) stored,
  starts_on             date not null,
  ends_on               date not null,
  created_by_user_id    uuid references public.users (id) on delete set null,
  created_at            timestamptz not null default now(),

  constraint outreach_cycles_name_not_blank check (length(btrim(name)) > 0),
  constraint outreach_cycles_dates_ordered check (starts_on <= ends_on),
  constraint outreach_cycles_name_key_unique unique (name_key)
);

comment on table public.outreach_cycles is
  'Named outreach stretches ("Spring 26") with a date range, for cycle-over-cycle '
  'analytics. Membership is derived at read time from event dates — rows are never '
  'stamped, so defining or moving a cycle re-labels history with no backfill.';
comment on column public.outreach_cycles.name_key is
  'lower(btrim(name)): case-insensitive uniqueness for cycle names.';

-- ---------------------------------------------------------------------------
-- Security. REVOKE before GRANT (matrix §2.1).
-- ---------------------------------------------------------------------------
revoke all on public.outreach_cycles from anon, authenticated;

alter table public.outreach_cycles enable row level security;

-- Shared read: a cycle is a name and two dates — no personal data — and the
-- analytics pickers that list them serve every active role.
grant select on public.outreach_cycles to authenticated;

create policy outreach_cycles_select_active on public.outreach_cycles
  for select to authenticated
  using ((select app.is_active_user()));

-- Writes are admin-only, matching the platform-settings:manage gate the
-- settings screen enforces at the application layer.
grant insert, update, delete on public.outreach_cycles to authenticated;

create policy outreach_cycles_insert_admin on public.outreach_cycles
  for insert to authenticated
  with check ((select app.is_active_user()) and (select app.is_admin()));

create policy outreach_cycles_update_admin on public.outreach_cycles
  for update to authenticated
  using ((select app.is_active_user()) and (select app.is_admin()))
  with check ((select app.is_active_user()) and (select app.is_admin()));

create policy outreach_cycles_delete_admin on public.outreach_cycles
  for delete to authenticated
  using ((select app.is_active_user()) and (select app.is_admin()));
