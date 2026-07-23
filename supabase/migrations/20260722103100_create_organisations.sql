-- Migration: create_organisations
-- Sequence step 3/17 (Data Model tab "11 Supabase Migration Sequence")
-- Story: F233 (#228) — Seed/Test Data (see the scope note in create_users)
-- Purpose: ORGANISATIONS — the core entity. "Client" is business language in the
--   user stories; the schema term is organisation, and there is no clients table.
--
-- Fields, types, nullability and enum values are taken from Data Model tab 04
-- (ORGANISATIONS) and tab 02 (Data Dictionary).
--
-- Two documented deviations from tab 04:
--   1. last_reply_sentiment and last_reply_intent are omitted. Both are typed `enum`
--      there but their allowed values are defined nowhere in the Data Model, and an
--      enum type cannot be created without members. Both are nullable and unused
--      until replies exist, so they are added by a later migration once the reply
--      classification owner agrees the value sets. (Raised on F041 #41.)
--   2. is_seed is added — see the column comment. Mirrored into Data Model tab 04
--      and tab 02 before this migration was written (SOP §7).
--
-- Reversibility: paired rollback in ../rollback/20260722103100_create_organisations.down.sql

-- Enum values are exactly those listed in Data Model tab 04. Adding a value later is
-- a one-way door in Postgres (a committed enum value cannot be dropped), so these
-- should not be extended without the Wednesday-call agreement required by SOP §7.
create type public.entry_method as enum ('api', 'manual');
create type public.organisation_type as enum ('charity', 'company', 'both', 'other');
create type public.geographic_reach as enum ('local', 'regional', 'national', 'international');
create type public.outreach_status as enum (
  'not_started',
  'queued',
  'contacted',
  'replied',
  'closed'
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trading_name text,
  country_code text not null default 'GB',
  is_international boolean not null default false,
  entry_method public.entry_method not null,
  is_verified boolean not null default false,
  organisation_type public.organisation_type not null,
  website text,
  contact_email text,
  address_line_1 text,
  city text,
  postcode text,
  geographic_reach public.geographic_reach,
  outreach_status public.outreach_status not null default 'not_started',
  data_completeness_score numeric,
  owner_id uuid references public.users (id) on delete set null,
  -- F233: marks a row created by the seed script. The seed script deletes by this
  -- column before re-inserting, which is what makes it idempotent. An email-domain
  -- marker cannot serve this purpose: contact_email is nullable, and roughly a third
  -- of seeded rows deliberately have no email.
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- is_international is derived from country_code (tab 04): true exactly when the
  -- organisation is not GB-based. Enforced here so the two can never disagree.
  constraint organisations_international_matches_country
    check (is_international = (country_code <> 'GB')),
  -- Tab 04 documents the score as a 0-1 coverage figure.
  constraint organisations_completeness_score_range
    check (data_completeness_score is null
           or (data_completeness_score >= 0 and data_completeness_score <= 1))
);

comment on table public.organisations is
  'Core entity (Data Model tab 04 ORGANISATIONS). Called "client" in the user stories.';
comment on column public.organisations.is_seed is
  'True for rows created by scripts/seed.mts (F233). Real records are always false.';
comment on column public.organisations.data_completeness_score is
  'Share of optional profile fields that are populated, 0-1. Computed, not entered.';

-- Sequence step 16 (create_indexes) is the general performance pass. These three are
-- created here because they back behaviour introduced by this migration: the pipeline
-- filter, the ownership join, and the seed script's delete-by-marker.
create index organisations_outreach_status_idx on public.organisations (outreach_status);
create index organisations_owner_id_idx on public.organisations (owner_id);
create index organisations_is_seed_idx on public.organisations (is_seed) where is_seed;

create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

-- RLS enabled with its policies in the creating migration (SOP §7).
alter table public.organisations enable row level security;

-- The pipeline is shared: every active user can see every organisation, which is what
-- makes the team pipeline view and ownership handover possible.
create policy organisations_select_authenticated on public.organisations
  for select to authenticated
  using (true);

create policy organisations_insert_authenticated on public.organisations
  for insert to authenticated
  with check (true);

-- Anyone on the team may update an unowned organisation or one they own; admins may
-- update any. This is what lets a CAM claim an organisation by setting owner_id.
create policy organisations_update_owner_or_admin on public.organisations
  for update to authenticated
  using (owner_id is null or owner_id = auth.uid() or public.is_admin())
  with check (owner_id is null or owner_id = auth.uid() or public.is_admin());

-- Deletion is destructive and rare — admins only. The seed script deletes its own
-- rows through the service role, which bypasses RLS.
create policy organisations_delete_admin on public.organisations
  for delete to authenticated
  using (public.is_admin());
