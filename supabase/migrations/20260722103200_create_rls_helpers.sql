-- Migration: create_rls_helpers
-- Sequence step 3a/17 (runs after create_organisations; Data Model tab 11)
-- Story: F224 (#219) — Row-Level Security
-- Purpose: the extra RLS predicates the per-table policies are built from, beyond the
--   base role checks. create_users (F233) already provides app.is_admin() and
--   app.is_active_user(); this migration adds the CAM and ownership predicates that
--   the outreach, notes and tag policies need, defined once so 30+ table migrations do
--   not each re-implement them.
-- Spec: docs/rls-permission-matrix.md
-- Reversibility: paired rollback in ../rollback/20260722103200_create_rls_helpers.down.sql
--
-- Placed after create_organisations because owns_organisation() reads
-- public.organisations. It is not needed earlier: create_users and
-- create_organisations (steps 2-3) build their policies on their own base helpers;
-- the first consumer of anything here is the notes table (step 4).
--
-- Naming: the `app` schema is created by create_users (F233), which now also holds
-- app.is_admin / app.is_active_user — kept out of `public` so PostgREST cannot expose
-- them as REST RPCs (security advisors 0028 / 0029). This migration adds more
-- predicates to the same schema. They build on the base rather than duplicating the
-- role lookup, and are equally unexposed.
--
-- WHY SECURITY DEFINER: a predicate that reads public.users or public.organisations
--   from inside a policy on those same tables would recurse under RLS. Running as the
--   owner bypasses RLS and terminates the lookup. The functions are therefore a
--   privilege boundary: none takes a table name, column name, or predicate fragment
--   as an argument.
-- WHY STABLE: the planner caches the result within a statement — one lookup per query,
--   not one per row.
-- WHY set search_path = '': a SECURITY DEFINER function with an unpinned search_path
--   can be hijacked by a caller-controlled shadowing object. Every reference is fully
--   schema-qualified.

create schema if not exists app;

comment on schema app is
  'RLS helper predicates. Not exposed via PostgREST. app.is_admin / app.is_active_user '
  'come from create_users (F233); the CAM and ownership predicates here from F224.';

-- ---------------------------------------------------------------------------
-- Role predicates
-- ---------------------------------------------------------------------------
-- public already has is_admin() and is_active_user(). These add the CAM checks,
-- following the same independent-lookup pattern rather than a shared role function.

create or replace function app.is_cam()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
     where id = (select auth.uid()) and role = 'cam' and is_active
  );
$$;

create or replace function app.can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
     where id = (select auth.uid()) and role in ('admin', 'cam') and is_active
  );
$$;

comment on function app.can_write() is
  'Admin or CAM. Viewers are read-only per PRD 4.3 (no notes, no suggestions, no sends).';

-- ---------------------------------------------------------------------------
-- Ownership predicates (F018 contact permission rules)
-- ---------------------------------------------------------------------------

create or replace function app.owns_organisation(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organisations
     where id = p_organisation_id
       and owner_id = (select auth.uid())
  );
$$;

create or replace function app.organisation_is_unowned(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organisations
     where id = p_organisation_id
       and owner_id is null
  );
$$;

create or replace function app.can_contact_organisation(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_admin()
      or (
        app.is_cam()
        and (
          app.owns_organisation(p_organisation_id)
          or app.organisation_is_unowned(p_organisation_id)
        )
      );
$$;

comment on function app.can_contact_organisation(uuid) is
  'PRD 4.3: admin may contact any organisation; a CAM may contact one they own or one '
  'nobody owns; a CAM may never contact another CAM''s organisation. Use as the WITH '
  'CHECK on OUTREACH_MESSAGES INSERT. Claiming an unowned organisation is a separate '
  'atomic RPC (claim_organisation) — do not let a policy imply the claim.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Callable by signed-in users only. `anon` is deliberately excluded: public
-- self-sign-up is prohibited (PRD 4.2) and anon must reach nothing. Revoking from
-- public first is required — execute defaults to public on create.

revoke execute on all functions in schema app from public;

grant usage on schema app to authenticated, service_role;

grant execute on function
    app.is_cam(),
    app.can_write(),
    app.owns_organisation(uuid),
    app.organisation_is_unowned(uuid),
    app.can_contact_organisation(uuid)
  to authenticated, service_role;
