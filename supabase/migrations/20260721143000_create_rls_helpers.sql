-- Migration: create_rls_helpers
-- Sequence step 2a/17 (runs alongside create_users; see Data Model tab "11 Supabase Migration Sequence")
-- Story: F224 (#224) — Row-Level Security
-- Purpose: the shared predicate library every table's RLS policies are built from.
--   Defined once here so that 30+ table migrations do not each re-implement a role
--   lookup, and so a change to the role model is a one-file change.
-- Spec: docs/rls-permission-matrix.md
-- Reversibility: paired rollback in ../rollback/20260721143000_create_rls_helpers.down.sql
--
-- WHY SECURITY DEFINER (this is the load-bearing detail):
--   A policy on "USERS" that reads "USERS" to find the caller's role recurses
--   infinitely. These functions run as their owner, which bypasses RLS, so the role
--   lookup terminates. That also means the functions themselves are a privilege
--   boundary: they must never take a table name, a column name, or any predicate
--   fragment as an argument.
--
-- WHY STABLE: the planner caches the result within a single statement, so a query
--   over 10,000 rows performs one role lookup, not 10,000.
--
-- WHY set search_path = '': a SECURITY DEFINER function without a pinned search_path
--   can be hijacked by a caller who creates a shadowing object in a schema they
--   control. Every reference below is therefore fully schema-qualified.
--
-- This migration is safe to apply before create_users: plpgsql bodies are not
-- resolved against tables until first call, and nothing calls these until the first
-- policy exists.

create schema if not exists app;

comment on schema app is
  'Internal helper functions for RLS policies. Not exposed via PostgREST.';

-- ---------------------------------------------------------------------------
-- Role lookup
-- ---------------------------------------------------------------------------

create or replace function app.current_user_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select u.role::text
    into v_role
    from public."USERS" u
   where u.id = (select auth.uid())
     and u.is_active;

  return v_role;  -- null when signed out, unknown, or deactivated
end;
$$;

comment on function app.current_user_role() is
  'Authoritative role for the current caller, from USERS. Returns null for a '
  'deactivated or unknown user, so every downstream check fails closed. '
  'Never read the role from a JWT claim: a claim is only as fresh as the token, '
  'and PRD 4.2 requires deactivation to take effect immediately.';

-- ---------------------------------------------------------------------------
-- Role predicates
-- ---------------------------------------------------------------------------

create or replace function app.is_active_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_user_role() is not null;
$$;

comment on function app.is_active_user() is
  'True for any signed-in, active user. AND this into every policy: it is what '
  'makes deactivation revoke access without waiting for token expiry.';

create or replace function app.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_user_role() = 'admin';
$$;

create or replace function app.is_cam()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_user_role() = 'cam';
$$;

create or replace function app.is_viewer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_user_role() = 'viewer';
$$;

create or replace function app.can_write()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_user_role() in ('admin', 'cam');
$$;

comment on function app.can_write() is
  'Admin or CAM. Viewers are read-only per PRD 4.3 (no notes, no suggestions, '
  'no sends).';

-- ---------------------------------------------------------------------------
-- Ownership predicates (F018 contact permission rules)
-- ---------------------------------------------------------------------------

create or replace function app.owns_organisation(p_organisation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select o.owner_id
    into v_owner
    from public."ORGANISATIONS" o
   where o.id = p_organisation_id;

  return v_owner is not null
     and v_owner = (select auth.uid());
end;
$$;

create or replace function app.organisation_is_unowned(p_organisation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select o.owner_id
    into v_owner
    from public."ORGANISATIONS" o
   where o.id = p_organisation_id;

  return v_owner is null;
end;
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
  'PRD 4.3: admin may contact any organisation; a CAM may contact one they own or '
  'one nobody owns; a CAM may never contact another CAM''s organisation. Use as the '
  'WITH CHECK on OUTREACH_MESSAGES INSERT. Claiming an unowned organisation is a '
  'separate atomic RPC (claim_organisation) — do not let a policy imply the claim.';

-- ---------------------------------------------------------------------------
-- Privileged-column guard
-- ---------------------------------------------------------------------------
-- Attach in the create_users migration:
--   create trigger users_guard_privileged_columns before update on public."USERS"
--     for each row execute function app.guard_privileged_user_columns();
--
-- Column privileges are the primary control (docs/rls-permission-matrix.md §2.1);
-- this is the second line. Supabase grants ALL on new public tables to
-- `authenticated` by default, so a single missing REVOKE in a future migration
-- silently reopens role escalation. This makes that failure loud instead.

create or replace function app.guard_privileged_user_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active)
     and not app.is_admin() then
    raise exception
      'USERS.role and USERS.is_active are admin-only; use the admin RPC (F012)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function app.guard_privileged_user_columns() is
  'Blocks non-admin writes to USERS.role and USERS.is_active. Raises 42501 so the '
  'app layer treats it exactly like an RLS denial and writes the same audit entry.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Callable by signed-in users only. `anon` is deliberately excluded: public
-- self-sign-up is prohibited (PRD 4.2) and anon must reach nothing.
-- Revoking from public first is required — execute defaults to public on create.

revoke execute on all functions in schema app from public;

grant usage on schema app to authenticated, service_role;

grant execute on function
    app.current_user_role(),
    app.is_active_user(),
    app.is_admin(),
    app.is_cam(),
    app.is_viewer(),
    app.can_write(),
    app.owns_organisation(uuid),
    app.organisation_is_unowned(uuid),
    app.can_contact_organisation(uuid)
  to authenticated, service_role;
