-- Migration: create_outreach_preferences
-- Sequence step 21.0 (addition to the Data Model migration sequence, appended after
--   step 20.0 create_user_onboarding rather than renumbered, same reason as that
--   migration: steps 4-17 are still unrun).
-- Story: F195 Outreach Preferences (#191)
-- Spec: docs/rls-permission-matrix.md §3.13
--
-- SCOPE (per the scope note on #191, 5 Aug 2026): a CAM sets geography, sector and
--   size preferences, and they are saved, persist, and are readable by other
--   features. The queue actually reordering is F094 (#93) — not this migration, not
--   built here. F196-F198 stay as F094's per-dimension scoring stories; this table
--   only stores the CAM's stated preference, it does not score anything.
--
-- MVP FIELDS (resolved 5 Aug 2026, "which preferences are MVP" on #191): geography,
--   sector, size. "Previous contact" (mentioned in the issue's Additional Context) has
--   no F19x story and is dropped from this table.
--
-- COLUMN TYPES MIRROR ORGANISATIONS, SO A FUTURE MATCH IS A PLAIN COMPARISON:
--   preferred_geographic_reach reuses public.geographic_reach (defined in
--   20260722103100_create_organisations.sql) — same enum as
--   ORGANISATIONS.geographic_reach. preferred_income_bands reuses public.income_band
--   (defined in 20260804180000_create_org_children.sql) — same enum as
--   FINANCIAL_PERIODS.income_band. preferred_sectors is text[], because
--   ORGANISATIONS.sector is free text (LLM-classified, no enum) — an enum column here
--   would immediately drift from the values it's meant to match against.
--
-- ONE ROW PER CAM, NOT A LIST OF PREFERENCE ROWS:
--   This is a settings screen, not a log — a CAM has exactly one current set of
--   preferences, and saving replaces it. A unique constraint on user_id plus an
--   upsert from the server action is simpler than reasoning about which row is
--   "current" in a one-to-many shape, and there is no requirement anywhere in #191
--   to keep preference history.
--
-- WHY NO AUDIT_LOG ROW:
--   docs/audit-log-pattern.md §1 scopes the requirement to writes that change
--   ownership, status, role, or approval state. A CAM's own outreach preferences are
--   none of those — they are the user's own view/config state and grant nothing, the
--   same reasoning already applied to USER_ONBOARDING_STEPS
--   (20260805100000_create_user_onboarding.sql). Ordinary RLS-governed write, not a
--   SECURITY DEFINER RPC.
--
-- Schema change approval record (SOP §7):
--   Change        | Add OUTREACH_PREFERENCES table
--   Reason        | F195 — CAMs need to set and persist geography/sector/size
--                 | outreach preferences (#191).
--   Compatibility | New table. Nothing existing reads or writes it. F094 (#93) is the
--                 | first consumer and is not built yet.
--   Data migration| None.
--   Security      | RLS on, own-row SELECT/INSERT/UPDATE for active users, no DELETE
--                 | grant (see below). Policies in this migration.
--   Documentation | Data Model tab 04 + tab 02 NOT YET updated — see TODO below, same
--                 | gap already open for step 20.0 (create_user_onboarding).
--
-- TODO (spreadsheet, not code): add step 21.0 create_outreach_preferences to Data
--   Model tab "11 Supabase Migration Sequence", and add an OUTREACH_PREFERENCES tab
--   (or a row set on an existing preferences tab) to tab 04 + tab 02 Data Dictionary.
--   Implemented here per MIGRATIONS.md convention; the spreadsheet is the thing that
--   is behind, not this file — same note as 20260805100000's TODO.
--
-- Reversibility: paired rollback in ../rollback/20260805110000_create_outreach_preferences.down.sql

create table public.outreach_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  preferred_geographic_reach public.geographic_reach[] not null default '{}',
  preferred_sectors text[] not null default '{}',
  preferred_income_bands public.income_band[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per CAM (see note above). The server action upserts on this.
  unique (user_id)
);

comment on table public.outreach_preferences is
  'F195: a CAM''s outreach preferences (geography, sector, size). One row per user. '
  'Read by F094 to personalise the queue; does not itself score or reorder anything.';
comment on column public.outreach_preferences.preferred_geographic_reach is
  'Subset of public.geographic_reach the CAM wants prioritised. Empty array means no '
  'geography preference set, not "match nothing".';
comment on column public.outreach_preferences.preferred_sectors is
  'Free-text sector values, matched against ORGANISATIONS.sector. Empty array means '
  'no sector preference set.';
comment on column public.outreach_preferences.preferred_income_bands is
  'Subset of public.income_band the CAM wants prioritised, matched against '
  'FINANCIAL_PERIODS.income_band. Empty array means no size preference set.';

-- Revoke before granting: Supabase default-grants all privileges on new public tables
-- to anon and authenticated, so a policy alone would leave every column writable
-- (MIGRATIONS.md, RLS recipe step 1). anon gets nothing.
revoke all on public.outreach_preferences from anon, authenticated;
grant select, insert, update on public.outreach_preferences to authenticated;
-- No DELETE: clearing preferences is "set every array back to empty" via UPDATE, not
-- row removal. This keeps "no preferences set" a single, always-present state
-- (empty arrays) rather than a row that may or may not exist, which is one fewer
-- case for F094 to handle when it reads this table.

alter table public.outreach_preferences enable row level security;

-- Own row only, and only while the account is active — app.is_active_user() is ANDed
-- into every policy so deactivation bites immediately, per the RLS recipe. No admin
-- read here: nothing in #191 needs one, and F187 (admin views a CAM's settings, P3)
-- can add it with a stated reason when it is actually built — same call already made
-- for USER_ONBOARDING_STEPS (§3.12).
create policy outreach_preferences_select_own on public.outreach_preferences
  for select to authenticated
  using (app.is_active_user() and user_id = (select auth.uid()));

-- No app.can_write(): that helper gates client-data writes and excludes viewers
-- (F258). This table holds a user's own settings, grants nothing, and is harmless
-- for any active role to write about themselves — same reasoning as
-- USER_ONBOARDING_STEPS's insert policy.
create policy outreach_preferences_insert_own on public.outreach_preferences
  for insert to authenticated
  with check (app.is_active_user() and user_id = (select auth.uid()));

create policy outreach_preferences_update_own on public.outreach_preferences
  for update to authenticated
  using (app.is_active_user() and user_id = (select auth.uid()))
  with check (app.is_active_user() and user_id = (select auth.uid()));

create trigger outreach_preferences_set_updated_at
  before update on public.outreach_preferences
  for each row execute function public.set_updated_at();
