-- Migration: adopt_ensure_rls_event_trigger
-- Sequence step: none (infrastructure — creates no Data Model entity; Data Model tab 11
--   sequences tables, and this migration adds only a database-level guard)
-- Story: F224 (#219) — Row-Level Security
-- Purpose: bring the `ensure_rls` event trigger under version control, and give staging
--   the same guard production already has.
-- Reversibility: paired rollback in ../rollback/20260726125834_adopt_ensure_rls_event_trigger.down.sql
--
-- BACKGROUND: 180connect-production was created with Supabase's "auto-enable RLS"
-- project option turned on; 180connect-staging was created with it off. That option
-- installs public.rls_auto_enable() plus an `ensure_rls` event trigger, so production
-- carried an object no migration described (contrary to "never make an untracked manual
-- change to a live database", MIGRATIONS.md) and staging did not reproduce production's
-- DDL behaviour. This migration adopts the object rather than dropping it: it is a
-- genuine last-resort net for the one case CI cannot see — a table created directly
-- against a live database rather than through a migration.
--
-- NOT A SUBSTITUTE FOR THE RECIPE. RLS and its policies still belong in the same
-- migration as `create table` (SOP §7; MIGRATIONS.md "securing a new table"), and
-- scripts/verify-rls-coverage.sql still gates every migration. This trigger enables RLS
-- with *no policies*, which is deny-all: it fails safe, it does not make a table usable.
--
-- MOVED public -> app: the function was in `public`, so PostgREST exposed it as
-- /rest/v1/rpc/rls_auto_enable to anon and authenticated (advisors 0028/0029). It
-- returns event_trigger and so cannot meaningfully be invoked over REST, but the F233
-- precedent is that no SECURITY DEFINER helper lives in an exposed schema. Same
-- treatment here.
--
-- WHY SECURITY DEFINER: the trigger must ALTER tables it does not own.
-- WHY set search_path = '': an unpinned search_path on a SECURITY DEFINER function can
--   be hijacked by a caller-controlled shadowing object. Production's copy pinned
--   'pg_catalog'; this pins '' and schema-qualifies every reference, per MIGRATIONS.md.

-- 1. app schema already exists (create_users, F233) — idempotent for a clean rebuild.
create schema if not exists app;

-- 2. The function, in the unexposed schema.
create or replace function app.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_catalog.pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    -- `public` only: `app` holds helper functions, and the Supabase-managed schemas
    -- (auth, storage, realtime) own their own RLS and must not be altered from here.
    if cmd.schema_name = 'public' then
      begin
        execute pg_catalog.format(
          'alter table if exists %s enable row level security', cmd.object_identity
        );
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          -- Never fail the DDL that triggered us: verify-rls-coverage.sql is the gate
          -- that blocks a missing policy, and a hard error here would break a legitimate
          -- migration on a table the trigger simply cannot alter.
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skipped % (schema % is not enforced)',
        cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;

comment on function app.rls_auto_enable() is
  'F224: enables RLS on any new public table as a last-resort net for tables created '
  'outside the migration path. Enables RLS only, never policies, so the result is '
  'deny-all. Adopted from the Supabase project-creation option that production was '
  'built with; see the migration header.';

-- 3. Repoint the event trigger. Dropping first makes this re-runnable, and lets
--    production (where `ensure_rls` already exists on the public function) converge on
--    the same definition as staging (where it does not exist at all).
drop event trigger if exists ensure_rls;

create event trigger ensure_rls
  on ddl_command_end
  execute function app.rls_auto_enable();

-- 4. Retire the exposed copy. Safe only after the trigger no longer references it.
drop function if exists public.rls_auto_enable();
