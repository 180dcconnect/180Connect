-- Migration: create_users
-- Sequence step 2/17 (Data Model tab "11 Supabase Migration Sequence")
-- Story: F233 (#228) — Seed/Test Data
--   Sequence steps 2 and 3 were originally expected to land under F041. F041's user
--   story is about *incoming records* sharing a field structure (an import-layer
--   concern, dependent on F038); the table DDL is infrastructure underneath it, and
--   F233 cannot seed a table that does not exist. Decision: Bashir (Project Leader),
--   22 Jul 2026 — DDL for steps 2-3 lands here, F041 keeps ingest-time standardisation.
-- Purpose: USERS — the application mirror of auth.users, carrying role and is_active.
--
-- Naming: the Data Model writes table names UPPER_SNAKE. Postgres folds unquoted
-- identifiers to lower case, so `USERS` in the Data Model is `public.users` here.
-- The alternative — quoting "USERS" everywhere — would force every query in the
-- codebase to quote it too. Field names are lower_snake in both (SOP §7).
--
-- Reversibility: paired rollback in ../rollback/20260722103000_create_users.down.sql

-- Role determines what a user may do. Values from Data Model tab 04 (USERS.role).
create type public.user_role as enum ('cam', 'admin', 'viewer');

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'cam',
  is_active boolean not null default true,
  invited_by_user_id uuid references public.users (id) on delete set null,
  last_seen_at timestamptz,
  -- F233: marks a row created by the seed script so seed data is queryable and
  -- deletable, and can never be confused with a real account.
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  'Application mirror of auth.users (Data Model tab 04 USERS). Row is created automatically by handle_new_auth_user() when a Supabase Auth user is created.';
comment on column public.users.is_seed is
  'True for rows created by scripts/seed.mts (F233). Real accounts are always false.';

create index users_role_idx on public.users (role);
-- Seed cleanup deletes by this marker on every run, so it is worth an index.
create index users_is_seed_idx on public.users (is_seed) where is_seed;

-- Keeps updated_at honest without every caller having to remember it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- Pinned so the function cannot be hijacked by a caller-controlled search_path
-- (Supabase linter 0011). now() resolves from pg_catalog regardless.
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- SECURITY DEFINER helpers live in the `app` schema, NOT public. PostgREST exposes
-- only public (and graphql_public), so a function in `app` is never reachable as a
-- REST RPC — which is what closes Supabase security advisors 0028 / 0029 (a
-- SECURITY DEFINER function callable via the API by anon / authenticated). They still
-- work inside RLS policies: a policy calls app.is_admin() by its qualified name, and
-- authenticated is granted EXECUTE below. Revoking EXECUTE instead of moving the
-- function does NOT work — verified 23 Jul 2026: a policy calling a function the
-- querying role cannot EXECUTE fails with 42501, so the policy would deny everyone.
create schema if not exists app;
comment on schema app is
  'SECURITY DEFINER helpers for RLS. Not in PostgREST''s exposed schemas, so never '
  'callable as REST RPCs. Granted EXECUTE to authenticated only for policy evaluation.';

-- Mirrors a newly registered auth user into public.users. SECURITY DEFINER because it
-- runs as part of Supabase Auth's own insert, which has no rights on this table.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- Answers "is the current user an admin?" without reading public.users through RLS,
-- which would recurse: a policy on users cannot query users under its own policy.
create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = (select auth.uid()) and role = 'admin' and is_active
  );
$$;

-- Answers "is the current user active?" — same SECURITY DEFINER trick as is_admin to
-- avoid the policy-on-users recursion. This is what makes deactivation bite at the
-- database layer: PRD §4.2 says a deactivated account cannot act, and gating every
-- policy on this means it stops reading and writing the instant is_active flips,
-- without waiting for the JWT to expire.
create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = (select auth.uid()) and is_active
  );
$$;

-- app.is_admin / app.is_active_user are called from policies, so authenticated needs
-- EXECUTE. handle_new_auth_user is a trigger function: it fires in the trigger's own
-- context and needs no caller EXECUTE, so it is granted to nobody. Revoke from public
-- first — EXECUTE defaults to public on create.
revoke execute on all functions in schema app from public;
grant usage on schema app to authenticated, service_role;
grant execute on function app.is_admin(), app.is_active_user()
  to authenticated, service_role;

-- Column privileges — REVOKE before GRANT.
-- Supabase ships `alter default privileges in schema public grant all on tables to
-- anon, authenticated, service_role`, so this table is born with full SELECT/INSERT/
-- UPDATE/DELETE on every column already granted to anon and authenticated. Without
-- the revoke, the row policies below still let a user update their *own* row — and
-- nothing stops that update from being `set role = 'admin'`. Verified against staging
-- on 22 Jul 2026: a CAM escalated to admin through exactly this gap.
--
-- anon is granted nothing: public self-sign-up is prohibited (PRD §4.2).
-- authenticated may read the directory and edit one column of their profile. role and
-- is_active are granted to nobody — a role change goes through the admin RPC (F012),
-- which runs SECURITY DEFINER and re-checks is_admin() itself. This cannot be narrowed
-- to "admins only" with a column grant, because column privileges attach to the
-- `authenticated` Postgres role that every signed-in user shares.
-- service_role keeps its default grants, which is how the seed and the auth trigger work.
revoke all on public.users from anon, authenticated;
grant select on public.users to authenticated;
grant update (full_name) on public.users to authenticated;

-- RLS is enabled and its policies added in the same migration that creates the
-- table (SOP §7). Sequence step 15 (F224) verifies this, it does not introduce it.
alter table public.users enable row level security;

-- The team is visible to the active team: CAMs need to see who owns which
-- organisation. A deactivated user reads nothing (PRD §4.2).
create policy users_select_active on public.users
  for select to authenticated
  using (app.is_active_user());

-- A user maintains their own profile; admins maintain anyone's. The column grant
-- above is what confines this to full_name; this policy governs which *rows* are in
-- reach. Both the actor being active and the row check are required.
create policy users_update_self_or_admin on public.users
  for update to authenticated
  using (app.is_active_user() and (id = (select auth.uid()) or app.is_admin()))
  with check (app.is_active_user() and (id = (select auth.uid()) or app.is_admin()));

-- No insert or delete policy: rows arrive via the auth trigger, and removal happens
-- through auth.users. The service role bypasses RLS, which is how seeding works.
