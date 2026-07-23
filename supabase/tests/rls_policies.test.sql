-- RLS behaviour tests — F224 (#219)
-- Spec: docs/rls-permission-matrix.md §5. Run by `supabase test db` (pg_prove).
--
-- These tests run as real end-user roles, never as service_role. service_role
-- bypasses RLS entirely, so a suite written against it proves nothing — it would
-- pass against a database with no policies at all.
--
-- Tables are created across sequence steps 2-13. Until a step lands, its tests
-- report as skipped rather than failing the build, so this file can be merged
-- ahead of the schema it describes and goes green as each table arrives.
--
-- Naming: tables are lower_snake in Postgres (public.users), UPPER_SNAKE only in the
-- Data Model. Base role helpers are public.is_admin / public.is_active_user
-- (create_users, F233); the CAM and ownership predicates are app.* (create_rls_helpers,
-- F224).
--
-- Everything runs inside one transaction and is rolled back; fixtures never persist.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------

create schema if not exists tests;

-- Impersonate a signed-in user. Mirrors what PostgREST does per request: assume
-- the `authenticated` role and set the JWT claims that auth.uid() reads.
create or replace function tests.login_as(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true  -- local: reset at transaction end
  );
  execute 'set local role authenticated';
end;
$$;

-- Dropping back to the owning role is inlined at each call site rather than
-- wrapped in a tests.logout() helper. While impersonating, the session IS
-- `authenticated`, which has no USAGE on schema `tests` — so it cannot call one.
-- Granting it that access would work, but a test harness that hands privileges to
-- the role under test can hide the very bugs it exists to catch. `reset role` and
-- set_config are both in pg_catalog and need no grant.

-- True when every named table exists, so a test group can skip cleanly. Names are
-- lower_snake to match the actual tables (to_regclass quotes via %I).
create or replace function tests.tables_exist(variadic p_tables text[])
returns boolean language plpgsql stable as $$
declare t text;
begin
  foreach t in array p_tables loop
    if to_regclass(format('public.%I', t)) is null then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Run a statement as a user and report the SQLSTATE it raised, or null if it
-- succeeded. Used for the misuse attempts, which must raise 42501.
create or replace function tests.sqlstate_of(p_user_id uuid, p_sql text)
returns text language plpgsql as $$
declare v_state text;
begin
  perform tests.login_as(p_user_id);
  begin
    execute p_sql;
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Four identities and three organisations, enough to express every ownership
-- case in the matrix: unowned, owned by self, owned by someone else.

create or replace function tests.seed()
returns void language plpgsql as $$
declare
  v_admin      uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a      uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b      uuid := '00000000-0000-4000-a000-000000000003';
  v_deactivated uuid := '00000000-0000-4000-a000-000000000004';
  v_backdated  timestamptz := timestamptz '2000-01-01';
begin
  -- public.users.id references auth.users; seed the auth side first. create_users
  -- has an on-insert trigger that mirrors auth.users into public.users, so the
  -- public.users insert is written ON CONFLICT DO UPDATE to set the role and the
  -- backdated timestamps the trigger's default row would not carry.
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
    (v_cam_a,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a@test.local'),
    (v_cam_b,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b@test.local'),
    (v_deactivated, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gone@test.local')
  on conflict (id) do nothing;

  -- Timestamps are backdated on purpose. public.set_updated_at() uses now(), which is
  -- transaction time, so a row created and updated in this same transaction would
  -- come out with updated_at = created_at and the trigger test could never fail.
  insert into public.users (id, email, full_name, role, is_active, created_at, updated_at)
  values
    (v_admin,       'admin@test.local', 'Test Admin',       'admin', true,  v_backdated, v_backdated),
    (v_cam_a,       'cam-a@test.local', 'Test CAM A',       'cam',   true,  v_backdated, v_backdated),
    (v_cam_b,       'cam-b@test.local', 'Test CAM B',       'cam',   true,  v_backdated, v_backdated),
    (v_deactivated, 'gone@test.local',  'Deactivated User', 'cam',   false, v_backdated, v_backdated)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at;

  if tests.tables_exist('organisations') then
    insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
    values
      ('00000000-0000-4000-b000-000000000001', 'Unowned Org Ltd', 'manual', 'other', null),
      ('00000000-0000-4000-b000-000000000002', 'CAM A Org Ltd',   'manual', 'other', v_cam_a),
      ('00000000-0000-4000-b000-000000000003', 'CAM B Org Ltd',   'manual', 'other', v_cam_b)
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Core: identity, ownership, deactivation
-- ---------------------------------------------------------------------------

create or replace function tests.suite_core()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b       uuid := '00000000-0000-4000-a000-000000000003';
  v_deactivated uuid := '00000000-0000-4000-a000-000000000004';
  v_org_unowned uuid := '00000000-0000-4000-b000-000000000001';
  v_org_cam_b   uuid := '00000000-0000-4000-b000-000000000003';
  v_count       bigint;
  v_ok          boolean;
begin
  if not tests.tables_exist('users') then
    return next skip(1, 'step 2 create_users not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Helper sanity: the CAM predicate must resolve from inside an impersonated
  -- session without recursing on the users policy that reads users.
  perform tests.login_as(v_cam_a);
  v_ok := app.is_cam();
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next ok(v_ok, 'app.is_cam() resolves for a CAM without recursing on users');

  -- Test 4 (misuse): a CAM may not promote themselves.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'update public.users set role = ''admin'' where id = %L', v_cam_a)),
    '42501',
    'CAM cannot escalate own role to admin'
  );

  -- Assert the resulting state, not only the error. On 22 Jul 2026 this escalation
  -- succeeded against staging (missing REVOKE — see matrix §2.1), and because it
  -- succeeded, every later check in the run passed while the "CAM" was an admin. A
  -- suite that only inspects SQLSTATE cannot tell those two worlds apart.
  select count(*) into v_count
    from public.users where id = v_cam_a and role = 'admin';
  return next is(v_count, 0::bigint,
    'CAM role is genuinely unchanged after the escalation attempt');

  -- The grant that makes the above hold. Checked directly so the suite reports the
  -- cause, not just the symptom, if a future migration forgets the REVOKE.
  return next ok(
    not has_column_privilege('authenticated', 'public.users', 'role', 'UPDATE'),
    'authenticated holds no UPDATE privilege on users.role'
  );
  return next ok(
    has_column_privilege('authenticated', 'public.users', 'full_name', 'UPDATE'),
    'authenticated can still update users.full_name (profile editing works)'
  );

  if tests.tables_exist('organisations') then
    -- Test 9 (permission failure): deactivation revokes access immediately, without
    -- waiting for the JWT to expire.
    perform tests.login_as(v_deactivated);
    select count(*) into v_count from public.organisations;
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
    return next is(v_count, 0::bigint,
      'deactivated user reads no organisations despite a valid token');

    -- Ownership (F233 model): a CAM claims an unowned organisation by setting
    -- owner_id to themselves. This is allowed.
    return next is(
      tests.sqlstate_of(v_cam_a, format(
        'update public.organisations set owner_id = %L where id = %L', v_cam_a, v_org_unowned)),
      null,
      'CAM can claim an unowned organisation by setting owner_id to themselves'
    );

    -- ...but may not hand one to another user. Reassignment is admin-only (matrix §2).
    return next is(
      tests.sqlstate_of(v_cam_a, format(
        'update public.organisations set owner_id = %L where id = %L', v_cam_b, v_org_unowned)),
      '42501',
      'CAM cannot assign an organisation to another user'
    );

    -- Shared read: every active role sees canonical data (PRD 4.3, F019).
    perform tests.login_as(v_cam_a);
    select count(*) into v_count from public.organisations;
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
    return next ok(v_count >= 3, 'CAM reads all canonical organisations including those owned by others');
  else
    return next skip(3, 'step 3 create_organisations not yet migrated');
  end if;

  -- Notes are shared: any CAM may write one on any org (F019).
  if tests.tables_exist('notes', 'organisations') then
    return next is(
      tests.sqlstate_of(v_cam_a, format(
        'insert into public.notes (organisation_id, author_id, content) values (%L, %L, ''test note'')',
        v_org_cam_b, v_cam_a)),
      null,
      'CAM can note an organisation owned by another CAM (shared visibility)'
    );
  else
    return next skip(1, 'step 4 create_org_children not yet migrated');
  end if;

  -- Tests 2 and 3: the F018 contact permission rule, the core of this story.
  if tests.tables_exist('outreach_messages', 'organisations') then
    return next is(
      tests.sqlstate_of(v_cam_a, format(
        'insert into public.outreach_messages (organisation_id, sent_by_user_id, subject, body, send_status)
         values (%L, %L, ''s'', ''b'', ''draft'')', v_org_unowned, v_cam_a)),
      null,
      'CAM can send to an unowned organisation'
    );

    return next is(
      tests.sqlstate_of(v_cam_a, format(
        'insert into public.outreach_messages (organisation_id, sent_by_user_id, subject, body, send_status)
         values (%L, %L, ''s'', ''b'', ''draft'')', v_org_cam_b, v_cam_a)),
      '42501',
      'CAM cannot send to an organisation owned by another CAM'
    );

    -- Impersonation guard: the WITH CHECK must pin sent_by_user_id to the caller.
    return next is(
      tests.sqlstate_of(v_cam_a, format(
        'insert into public.outreach_messages (organisation_id, sent_by_user_id, subject, body, send_status)
         values (%L, %L, ''s'', ''b'', ''draft'')', v_org_unowned, v_cam_b)),
      '42501',
      'CAM cannot attribute an outreach message to another user'
    );
  else
    return next skip(3, 'step 11 create_outreach not yet migrated');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sensitive data must be invisible, not merely un-writable
-- ---------------------------------------------------------------------------
-- A blocked SELECT returns zero rows and raises nothing. These assert row
-- counts; asserting an error here would silently never fire.

create or replace function tests.suite_sensitive()
returns setof text language plpgsql as $$
declare
  v_cam_a uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000003';
  v_count bigint;
begin
  if not tests.tables_exist('users') then
    return next skip(1, 'step 2 create_users not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Raw third-party payloads are admin-only (PRD 4.3).
  if tests.tables_exist('raw_source_records') then
    perform tests.login_as(v_cam_a);
    select count(*) into v_count from public.raw_source_records;
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
    return next is(v_count, 0::bigint, 'CAM sees zero raw source records');
  else
    return next skip(1, 'step 6 create_ingestion not yet migrated');
  end if;

  -- Scoring weights are admin-only — a CAM who can read them can game the queue.
  if tests.tables_exist('scoring_weights') then
    perform tests.login_as(v_cam_a);
    select count(*) into v_count from public.scoring_weights;
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
    return next is(v_count, 0::bigint, 'CAM sees zero scoring weights');
  else
    return next skip(1, 'step 8 create_model_config not yet migrated');
  end if;

  -- One CAM must not see another CAM's performance numbers.
  if tests.tables_exist('cam_activity_summary') then
    insert into public.cam_activity_summary (user_id, week_start)
    values (v_cam_a, date '2026-07-20'), (v_cam_b, date '2026-07-20')
    on conflict do nothing;

    perform tests.login_as(v_cam_a);
    select count(*) into v_count
      from public.cam_activity_summary
     where user_id <> v_cam_a;
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
    return next is(v_count, 0::bigint, 'CAM sees no other CAM''s activity rows');
  else
    return next skip(1, 'step 13 create_analytics not yet migrated');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log is append-only
-- ---------------------------------------------------------------------------

create or replace function tests.suite_audit()
returns setof text language plpgsql as $$
begin
  if not tests.tables_exist('audit_log') then
    return next skip(2, 'audit_log not in the Data Model yet — see docs/rls-permission-matrix.md §6');
    return;
  end if;

  -- Append-only by omission: no UPDATE or DELETE policy may exist for any role.
  return next is(
    (select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'audit_log'
        and cmd in ('UPDATE', 'DELETE')),
    0,
    'audit_log has no UPDATE or DELETE policy — an editable audit trail is not one'
  );

  return next is(
    tests.sqlstate_of('00000000-0000-4000-a000-000000000002',
      'delete from public.audit_log'),
    '42501',
    'CAM cannot delete audit entries'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Views must not launder data around the policies
-- ---------------------------------------------------------------------------
-- A view runs with its definer's rights unless created `with (security_invoker = on)`.
-- Every view over an RLS-protected table is therefore a bypass until proven otherwise.

create or replace function tests.suite_views()
returns setof text language plpgsql as $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and coalesce(
           (select option_value from pg_options_to_table(c.reloptions)
             where option_name = 'security_invoker'), 'false') <> 'true';

  return next is(v_bad, null,
    'every public view is security_invoker — a definer-rights view bypasses RLS');
end;
$$;

-- ---------------------------------------------------------------------------
-- users table controls (sequence step 2)
-- ---------------------------------------------------------------------------

create or replace function tests.suite_users()
returns setof text language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000002';
  v_name  text;
  v_when  timestamptz;
begin
  if not tests.tables_exist('users') then
    return next skip(6, 'step 2 create_users not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Deactivation is as privileged as promotion: a user who can clear their own
  -- is_active can also set someone else's.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'update public.users set is_active = false where id = %L', v_cam_a)),
    '42501',
    'CAM cannot change is_active'
  );

  -- Accounts come from the auth trigger / invite flow (F008); a client cannot insert.
  return next is(
    tests.sqlstate_of(v_cam_a,
      'insert into public.users (id, email, role) values (gen_random_uuid(), ''x@test.local'', ''admin'')'),
    '42501',
    'CAM cannot create a user account'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'delete from public.users where id = %L', v_admin)),
    '42501',
    'CAM cannot delete a user (deactivate, never delete)'
  );

  -- A CAM updating someone else's row is blocked by USING, which filters rather
  -- than raises. Asserting the error alone would pass whether or not the write
  -- landed, so assert the value.
  perform tests.sqlstate_of(v_cam_a, format(
    'update public.users set full_name = ''Hacked'' where id = %L', v_admin));
  select full_name into v_name from public.users where id = v_admin;
  return next is(v_name, 'Test Admin',
    'CAM cannot rename another user (blocked silently by USING, row unchanged)');

  -- anon reaches nothing. This is the REVOKE from matrix §2.1, not a policy.
  return next ok(
    not has_table_privilege('anon', 'public.users', 'SELECT'),
    'anon holds no SELECT privilege on users'
  );

  -- updated_at maintenance.
  perform tests.sqlstate_of(v_cam_a, format(
    'update public.users set full_name = ''Renamed'' where id = %L', v_cam_a));
  select updated_at into v_when from public.users where id = v_cam_a;
  return next ok(v_when > timestamptz '2000-01-01',
    'public.set_updated_at() stamps updated_at on write');
end;
$$;

-- ---------------------------------------------------------------------------

select * from tests.suite_core();
select * from tests.suite_users();
select * from tests.suite_sensitive();
select * from tests.suite_audit();
select * from tests.suite_views();

select * from finish();

rollback;
