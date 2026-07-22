-- Migration: create_users
-- Sequence step 2/17 (Data Model tab "11 Supabase Migration Sequence")
-- Stories: F016 Admin Role (#…), F017 CAM Role (#…), F224 Row-Level Security (#219)
-- Purpose: the USERS table — a mirror of auth.users carrying the authoritative
--   role and activation state. PRD §4.2: "The authoritative role is stored in
--   USERS and enforced through Supabase row-level security."
-- Spec: docs/rls-permission-matrix.md §3.1
-- Reversibility: paired rollback in ../rollback/20260722103000_create_users.down.sql
--
-- Fields follow Data Model tab "04 Entities" > USERS exactly.
--
-- Convention deviation, deliberate: MIGRATIONS.md says every table gets
-- `id uuid default gen_random_uuid()`. USERS does not generate its own id — it
-- takes auth.users.id, so that auth.uid() is directly usable as the primary key in
-- every policy in the schema. Generating a second id here would mean every policy
-- carried a join.

-- ---------------------------------------------------------------------------
-- Role enum
-- ---------------------------------------------------------------------------
-- An enum, not free text: the permission matrix is exhaustive over these three
-- values, and a typo'd role in a text column fails open (matches no policy, but
-- also matches no constraint). Service role is a Postgres role, not a value here.

create type public.user_role as enum ('admin', 'cam', 'viewer');

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public."USERS" (
  id                  uuid primary key
                        references auth.users (id) on delete restrict,
  email               text not null,
  full_name           text,
  role                public.user_role not null,
  is_active           boolean not null default true,
  invited_by_user_id  uuid references public."USERS" (id) on delete set null,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Identity, not performance — the index that enforces it is a constraint, so it
-- belongs here rather than in step 16 (create_indexes). Case-insensitive: an
-- invite to Ada@180dc.org and one to ada@180dc.org are the same person.
create unique index users_email_lower_key on public."USERS" (lower(email));

comment on table public."USERS" is
  'Platform users, mirroring auth.users. Role and activation live here, not in a '
  'JWT claim: PRD §4.2 requires a deactivation to bite immediately rather than at '
  'the next token refresh.';

comment on column public."USERS".id is
  'Same value as auth.users.id, so auth.uid() is the primary key in every RLS policy.';
comment on column public."USERS".role is
  'Authoritative role. Writable only via the admin RPC (F012) — see '
  'docs/rls-permission-matrix.md §2.1. Never inferred from an email domain (PRD §4.2).';
comment on column public."USERS".is_active is
  'False revokes all access immediately via app.is_active_user(). Deactivate; never delete.';
comment on column public."USERS".invited_by_user_id is
  'Null for the bootstrap admin, who has no inviter.';

-- ON DELETE RESTRICT, not CASCADE: PRD §4.2 deactivates accounts and retains
-- history, and NOTES.author_id / OUTREACH_MESSAGES.sent_by_user_id and the rest
-- reference this table. Deleting an auth user therefore fails loudly instead of
-- quietly removing the person who wrote the record.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- Generic; later table migrations reuse it rather than redefining their own.

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public."USERS"
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges — REVOKE FIRST
-- ---------------------------------------------------------------------------
-- Supabase ships `alter default privileges in schema public grant all on tables
-- to anon, authenticated, service_role`, so this table was born with SELECT,
-- INSERT, UPDATE and DELETE on every column already granted to anon and
-- authenticated. Without this revoke, the column grant below is a no-op and a CAM
-- can set their own role to 'admin' — verified against staging, 22 Jul 2026.
-- See docs/rls-permission-matrix.md §2.1.

revoke all on public."USERS" from anon, authenticated;

-- anon gets nothing: public self-sign-up is prohibited (PRD §4.2).
grant select on public."USERS" to authenticated;

-- The only column an ordinary user may write. Note this cannot be widened for
-- admins alone — column privileges attach to the Postgres role `authenticated`,
-- which every signed-in user shares. Role changes go through the admin RPC (F012),
-- which runs SECURITY DEFINER and re-checks app.is_admin() itself.
grant update (full_name) on public."USERS" to authenticated;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
-- Enabled in the same migration that creates the table (SOP §7). A table is never
-- committed with RLS off "for later".

alter table public."USERS" enable row level security;

-- Read: the team directory. Every active user sees every user (F011 View Team
-- Members). Deactivated users see nothing — app.is_active_user() is false for them.
create policy users_select on public."USERS"
  for select to authenticated
  using (app.is_active_user());

-- Update: own row, or any row if admin. The column grant above is what stops this
-- from also permitting a role change; this policy governs which *rows* are in play.
create policy users_update on public."USERS"
  for update to authenticated
  using (
    app.is_active_user()
    and (app.is_admin() or id = (select auth.uid()))
  )
  with check (
    app.is_active_user()
    and (app.is_admin() or id = (select auth.uid()))
  );

-- No INSERT policy: accounts are created by the invite flow (F008), which runs
-- server-side as service_role. No DELETE policy: deactivate, never delete.
-- Both omissions are deliberate — see the matrix §3.1.

-- Defence in depth behind the column grant.
create trigger users_guard_privileged_columns
  before update on public."USERS"
  for each row execute function app.guard_privileged_user_columns();
