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
-- Five identities and three organisations, enough to express every ownership
-- case in the matrix: unowned, owned by self, owned by someone else.

create or replace function tests.seed()
returns void language plpgsql as $$
declare
  v_admin      uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a      uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b      uuid := '00000000-0000-4000-a000-000000000003';
  v_deactivated uuid := '00000000-0000-4000-a000-000000000004';
  v_viewer     uuid := '00000000-0000-4000-a000-000000000005';  -- F258
  v_backdated  timestamptz := timestamptz '2000-01-01';
begin
  -- public.users.id references auth.users; seed the auth side first. create_users
  -- has an on-insert trigger that mirrors auth.users into public.users, so the
  -- public.users insert is written ON CONFLICT DO UPDATE to set the role and the
  -- backdated timestamps the trigger's default row would not carry.
  --
  -- Emails are @180dc.org, not a throwaway .local: F002 (enforce_180dc_email_trigger)
  -- adds a BEFORE INSERT trigger on auth.users rejecting any other domain, so the old
  -- .test.local fixtures now abort the whole suite. Real accounts are @180dc.org
  -- anyway (F002 is the point), so this is what the fixture should have used.
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@180dc.org'),
    (v_cam_a,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a@180dc.org'),
    (v_cam_b,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b@180dc.org'),
    (v_deactivated, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gone@180dc.org'),
    (v_viewer,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@180dc.org')
  on conflict (id) do nothing;

  -- Timestamps are backdated on purpose. public.set_updated_at() uses now(), which is
  -- transaction time, so a row created and updated in this same transaction would
  -- come out with updated_at = created_at and the trigger test could never fail.
  insert into public.users (id, email, full_name, role, is_active, created_at, updated_at)
  values
    (v_admin,       'admin@180dc.org', 'Test Admin',       'admin', true,  v_backdated, v_backdated),
    (v_cam_a,       'cam-a@180dc.org', 'Test CAM A',       'cam',   true,  v_backdated, v_backdated),
    (v_cam_b,       'cam-b@180dc.org', 'Test CAM B',       'cam',   true,  v_backdated, v_backdated),
    (v_deactivated, 'gone@180dc.org',  'Deactivated User', 'cam',   false, v_backdated, v_backdated),
    (v_viewer,      'viewer@180dc.org','Test Viewer',      'viewer',true,  v_backdated, v_backdated)
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
      'insert into public.users (id, email, role) values (gen_random_uuid(), ''x@180dc.org'', ''admin'')'),
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
-- Role-change RPC (F012) + audit trail
-- ---------------------------------------------------------------------------
-- The write-path the matrix reserves for an admin RPC. Also the concrete
-- "log entry created" testing note: a successful change writes one audit row.

create or replace function tests.suite_role_rpc()
returns setof text language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000003';
  v_role  text;
  v_count bigint;
begin
  if to_regprocedure('public.set_user_role(uuid, public.user_role)') is null then
    return next skip(4, 'set_user_role RPC not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Admin promotes a CAM, and exactly one audit row records the transition.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_user_role(%L, ''admin'')', v_cam_b)),
    null,
    'admin can change another user''s role via the RPC'
  );
  select role::text into v_role from public.users where id = v_cam_b;
  return next is(v_role, 'admin', 'the role change actually landed');

  if tests.tables_exist('audit_log') then
    select count(*) into v_count
      from public.audit_log
     where action = 'role_changed' and target_id = v_cam_b;
    return next is(v_count, 1::bigint,
      'the role change wrote exactly one audit_log row (log entry created)');
  else
    return next skip(1, 'audit_log not yet migrated');
  end if;

  -- A CAM cannot call it, even though EXECUTE is granted to authenticated — the
  -- body self-checks is_admin().
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_user_role(%L, ''admin'')', v_cam_a)),
    '42501',
    'CAM calling the role RPC is refused inside the SECURITY DEFINER body'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Viewer is read-only — F258 (#268)
-- ---------------------------------------------------------------------------
-- Matrix §1: viewer = read-only. §3.2: ORGANISATIONS UPDATE is "admin any row;
-- CAM may claim an unowned row" — viewer appears in neither.
--
-- These assert *state*, not SQLSTATE, and that is the whole point. A row excluded
-- by a policy's USING clause is invisible to the UPDATE: it matches nothing, zero
-- rows change, and nothing is raised. A suite that only asserted `42501` here would
-- pass against a database where the viewer silently rewrote the row and would pass
-- just as happily against one where they did not — it cannot tell the two apart.
-- INSERT is the exception: there is no row to filter, so the WITH CHECK fires and
-- does raise.
--
-- The fixture is local to this suite. The shared 'Unowned Org Ltd' stops being
-- unowned partway through suite_core (a CAM claims it, correctly), and every suite
-- runs in one uncommitted transaction with no reset in between.

create or replace function tests.suite_viewer()
returns setof text language plpgsql as $$
declare
  v_viewer  uuid := '00000000-0000-4000-a000-000000000005';
  v_cam_a   uuid := '00000000-0000-4000-a000-000000000002';
  v_org     uuid := '00000000-0000-4000-b000-000000000004';
  v_owner   uuid;
  v_name    text;
  v_count   bigint;
  v_is_viewer boolean;
begin
  if not tests.tables_exist('users') then
    return next skip(1, 'step 2 create_users not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- The predicate resolves without recursing on public.users, same as is_cam.
  perform tests.login_as(v_viewer);
  v_is_viewer := app.is_viewer();
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next ok(v_is_viewer, 'app.is_viewer() resolves for a viewer');

  perform tests.login_as(v_cam_a);
  v_is_viewer := app.is_viewer();
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next ok(not v_is_viewer, 'app.is_viewer() is false for a CAM');

  if not tests.tables_exist('organisations') then
    return next skip(6, 'step 3 create_organisations not yet migrated');
    return;
  end if;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values (v_org, 'Viewer Fixture Ltd', 'manual', 'other', null)
  on conflict (id) do update set owner_id = null, legal_name = 'Viewer Fixture Ltd';

  -- Read-only still means read: shared canonical visibility is not what F258 takes
  -- away (matrix §3.2, all roles SELECT).
  perform tests.login_as(v_viewer);
  select count(*) into v_count from public.organisations;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next ok(v_count >= 3, 'viewer reads canonical organisations');

  -- The escalation this story closes. Before the fix the USING clause tested only
  -- ownership, so `owner_id is null` admitted a viewer, and the WITH CHECK was then
  -- satisfied by the viewer naming themselves as the new owner.
  perform tests.sqlstate_of(v_viewer, format(
    'update public.organisations set owner_id = %L where id = %L', v_viewer, v_org));
  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, null::uuid,
    'viewer cannot claim an unowned organisation (F258: the escalation is closed)');

  -- ...and cannot edit canonical data on it either, owned or not.
  perform tests.sqlstate_of(v_viewer, format(
    'update public.organisations set legal_name = ''Viewer Was Here'' where id = %L', v_org));
  select legal_name into v_name from public.organisations where id = v_org;
  return next is(v_name, 'Viewer Fixture Ltd',
    'viewer cannot edit an organisation''s canonical fields');

  -- INSERT does raise: no existing row for USING to hide, so the WITH CHECK runs.
  return next is(
    tests.sqlstate_of(v_viewer,
      'insert into public.organisations (legal_name, entry_method, organisation_type)
       values (''Viewer Insert Ltd'', ''manual'', ''other'')'),
    '42501',
    'viewer cannot create an organisation'
  );

  perform tests.sqlstate_of(v_viewer, format(
    'delete from public.organisations where id = %L', v_org));
  select count(*) into v_count from public.organisations where id = v_org;
  return next is(v_count, 1::bigint, 'viewer cannot delete an organisation');

  -- Regression guard on the same policy: narrowing it to admin-or-CAM must not have
  -- taken the CAM's claim path with it. suite_core covers the happy path on the
  -- shared fixture; this re-checks it on a row whose state this suite controls.
  perform tests.sqlstate_of(v_cam_a, format(
    'update public.organisations set owner_id = %L where id = %L', v_cam_a, v_org));
  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, v_cam_a,
    'CAM can still claim an unowned organisation after the viewer lockout');
end;
$$;

-- ---------------------------------------------------------------------------
-- actions table controls (sequence step 19)
-- ---------------------------------------------------------------------------
-- Matrix §3.11. The assertions that matter most are 6 and 7: assignee_user_id
-- carries no UPDATE grant for anyone, which is what forces reassignment through
-- the audited F257 RPC instead of a bare write.

create or replace function tests.suite_actions()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b       uuid := '00000000-0000-4000-a000-000000000003';
  v_viewer      uuid := '00000000-0000-4000-a000-000000000005';
  v_org_cam_a   uuid := '00000000-0000-4000-b000-000000000002';
  v_org_cam_b   uuid := '00000000-0000-4000-b000-000000000003';
  v_action_a    uuid := '00000000-0000-4000-c000-000000000001';
  v_act_mine    uuid := '00000000-0000-4000-c000-000000000021';
  v_act_theirs  uuid := '00000000-0000-4000-c000-000000000022';
  v_assignee    uuid;
  v_status      public.action_status;
  v_count       bigint;
begin
  if not tests.tables_exist('actions', 'organisations', 'users') then
    return next skip(12, 'step 19 create_actions not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- A CAM raises their own work on a client they own.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.actions (organisation_id, assignee_user_id, created_by_user_id, title)
       values (%L, %L, %L, ''Follow up'')', v_org_cam_a, v_cam_a, v_cam_a)),
    null,
    'CAM can create an action for themselves on a client they own'
  );

  -- Assigning work to someone else is F169, admin-only.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.actions (organisation_id, assignee_user_id, created_by_user_id, title)
       values (%L, %L, %L, ''Do this'')', v_org_cam_a, v_cam_b, v_cam_a)),
    '42501',
    'CAM cannot assign an action to another CAM (F169 is admin-only)'
  );

  -- Unlike a note, an action on someone else's client is a claim on their work.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.actions (organisation_id, assignee_user_id, created_by_user_id, title)
       values (%L, %L, %L, ''Mine now'')', v_org_cam_b, v_cam_a, v_cam_a)),
    '42501',
    'CAM cannot create an action on a client owned by another CAM'
  );

  return next is(
    tests.sqlstate_of(v_viewer, format(
      'insert into public.actions (organisation_id, assignee_user_id, created_by_user_id, title)
       values (%L, %L, %L, ''Viewer work'')', v_org_cam_a, v_viewer, v_viewer)),
    '42501',
    'viewer cannot create an action'
  );

  -- Admin assigns across ownership boundaries (F169).
  return next is(
    tests.sqlstate_of(v_admin, format(
      'insert into public.actions (id, organisation_id, assignee_user_id, created_by_user_id, title)
       values (%L, %L, %L, %L, ''Admin assigned'')',
      v_action_a, v_org_cam_b, v_cam_a, v_admin)),
    null,
    'admin can assign an action to a CAM on any client'
  );

  -- F171: the assignee closes their own item. status and completed_at move together
  -- or the check constraint rejects the write.
  perform tests.sqlstate_of(v_cam_a, format(
    'update public.actions set status = ''completed'', completed_at = now() where id = %L',
    v_action_a));
  select status into v_status from public.actions where id = v_action_a;
  return next is(v_status, 'completed'::public.action_status,
    'assignee can mark their own action complete (F171)');

  -- The two that hold the F257 design up. A missing column privilege raises 42501
  -- regardless of the row policies, so this holds for admins too.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'update public.actions set assignee_user_id = %L where id = %L', v_cam_b, v_action_a)),
    '42501',
    'admin cannot reassign an action by direct write — the F257 RPC is the only path'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'update public.actions set assignee_user_id = %L where id = %L', v_cam_b, v_action_a)),
    '42501',
    'assignee cannot hand their action to another CAM'
  );

  select assignee_user_id into v_assignee from public.actions where id = v_action_a;
  return next is(v_assignee, v_cam_a,
    'assignee_user_id survives both blocked writes unchanged');

  -- Shared read (F019). F257 needs the incoming CAM to see the outgoing CAM's queue
  -- *before* the handover, so this is a requirement and not an oversight.
  perform tests.login_as(v_cam_b);
  select count(*) into v_count from public.actions where assignee_user_id = v_cam_a;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next ok(v_count > 0,
    'a CAM can read another CAM''s actions (handover visibility)');

  -- DELETE keys on authorship AND assignment. Authorship alone once let a CAM delete
  -- work that had been reassigned away from them (fixed in 20260803100000).
  insert into public.actions
    (id, organisation_id, assignee_user_id, created_by_user_id, title)
  values
    (v_act_mine,   v_org_cam_a, v_cam_a, v_cam_a, 'Raised for myself'),
    (v_act_theirs, v_org_cam_a, v_cam_b, v_cam_a, 'Raised, then handed on')
  on conflict (id) do nothing;

  perform tests.sqlstate_of(v_cam_a, format(
    'delete from public.actions where id = %L', v_act_mine));
  select count(*) into v_count from public.actions where id = v_act_mine;
  return next is(v_count, 0::bigint,
    'CAM can delete an open action they raised for themselves');

  perform tests.sqlstate_of(v_cam_a, format(
    'delete from public.actions where id = %L', v_act_theirs));
  select count(*) into v_count from public.actions where id = v_act_theirs;
  return next is(v_count, 1::bigint,
    'CAM cannot delete an action they raised once it belongs to someone else');
end;
$$;

-- ---------------------------------------------------------------------------
-- reassignment RPCs (F257)
-- ---------------------------------------------------------------------------
-- Matrix §3.11. Uses its own organisations rather than the shared fixture: earlier
-- suites move ownership around, and these assertions turn on exactly who owns what.

create or replace function tests.suite_reassign()
returns setof text language plpgsql as $$
declare
  v_admin        uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a        uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b        uuid := '00000000-0000-4000-a000-000000000003';
  v_deactivated  uuid := '00000000-0000-4000-a000-000000000004';
  v_viewer       uuid := '00000000-0000-4000-a000-000000000005';
  v_org_x        uuid := '00000000-0000-4000-d000-000000000001';  -- CAM A's client
  v_org_y        uuid := '00000000-0000-4000-d000-000000000002';  -- CAM B's client
  v_act_open     uuid := '00000000-0000-4000-c000-000000000011';  -- open, on org X
  v_act_done     uuid := '00000000-0000-4000-c000-000000000012';  -- completed, on org X
  v_act_cross    uuid := '00000000-0000-4000-c000-000000000013';  -- open, on org Y
  v_owner        uuid;
  v_assignee     uuid;
  v_detail       jsonb;
  v_actor        uuid;
  v_count        bigint;
begin
  if not tests.tables_exist('actions', 'organisations', 'users', 'audit_log')
     or to_regprocedure('public.reassign_ownership(uuid[], uuid, text, uuid)') is null then
    return next skip(16, 'reassignment RPCs not yet migrated');
    return;
  end if;

  perform tests.seed();

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    (v_org_x, 'Reassign Org X Ltd', 'manual', 'other', v_cam_a),
    (v_org_y, 'Reassign Org Y Ltd', 'manual', 'other', v_cam_b)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.actions
    (id, organisation_id, assignee_user_id, created_by_user_id, title, status, completed_at)
  values
    (v_act_open,  v_org_x, v_cam_a, v_cam_a, 'Open work',      'open',      null),
    (v_act_done,  v_org_x, v_cam_a, v_cam_a, 'Finished work',  'completed', now()),
    (v_act_cross, v_org_y, v_cam_a, v_admin, 'Cross-org work', 'open',      null)
  on conflict (id) do nothing;

  -- Permission paths first.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.reassign_ownership(array[%L]::uuid[], %L, ''taking over'', null)',
      v_org_x, v_cam_b)),
    '42501',
    'CAM cannot reassign client ownership'
  );

  return next is(
    tests.sqlstate_of(v_viewer, format(
      'select public.reassign_ownership(array[%L]::uuid[], %L, ''taking over'', null)',
      v_org_x, v_cam_b)),
    '42501',
    'viewer cannot reassign client ownership'
  );

  -- The reason is what makes the audit trail worth having; blank must not pass.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.reassign_ownership(array[%L]::uuid[], %L, ''   '', null)',
      v_org_x, v_cam_b)),
    '22023',
    'a blank reason is rejected'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.reassign_ownership(array[%L]::uuid[], %L, ''handover'', null)',
      v_org_x, v_deactivated)),
    '22023',
    'cannot reassign to a deactivated account'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.reassign_ownership(array[%L]::uuid[], %L, ''handover'', null)',
      v_org_x, v_viewer)),
    '22023',
    'cannot reassign to a viewer'
  );

  -- The offboarding path: CAM A leaves, CAM B inherits.
  perform tests.sqlstate_of(v_admin, format(
    'select public.reassign_ownership(array[%L]::uuid[], %L, ''CAM A offboarded'', %L)',
    v_org_x, v_cam_b, v_cam_a));

  select owner_id into v_owner from public.organisations where id = v_org_x;
  return next is(v_owner, v_cam_b, 'admin reassigns the client to the incoming CAM');

  select assignee_user_id into v_assignee from public.actions where id = v_act_open;
  return next is(v_assignee, v_cam_b, 'the outgoing CAM''s open action follows the client');

  -- History stays with whoever made it — the same principle as note and draft authorship.
  select assignee_user_id into v_assignee from public.actions where id = v_act_done;
  return next is(v_assignee, v_cam_a, 'a completed action does not follow the client');

  select assignee_user_id into v_assignee from public.actions where id = v_act_cross;
  return next is(v_assignee, v_cam_a,
    'an action on a client that was not reassigned is untouched');

  select actor_user_id, detail into v_actor, v_detail
    from public.audit_log
   where action = 'ownership_assigned' and target_id = v_org_x
   order by created_at desc limit 1;

  return next is(v_actor, v_admin,
    'the audit row names the acting admin, not the incoming CAM');

  return next is(
    jsonb_build_object(
      'from', v_detail->>'from_user_id',
      'to',   v_detail->>'to_user_id',
      'why',  v_detail->>'reason',
      'src',  v_detail->>'source',
      'n',    v_detail->>'actions_moved'),
    jsonb_build_object(
      'from', v_cam_a::text,
      'to',   v_cam_b::text,
      'why',  'CAM A offboarded',
      'src',  'offboarding',
      'n',    '1'),
    'the audit row carries both CAMs, the reason, the source and the action count'
  );

  -- Re-running the same stale selection must not seize the client back off CAM B.
  perform tests.sqlstate_of(v_admin, format(
    'select public.reassign_ownership(array[%L]::uuid[], %L, ''stale retry'', %L)',
    v_org_x, v_admin, v_cam_a));
  select owner_id into v_owner from public.organisations where id = v_org_x;
  return next is(v_owner, v_cam_b,
    'a stale p_from_user_id skips the row instead of overwriting a newer owner');

  -- The second half: F169 work on a client the offboarded CAM never owned.
  perform tests.sqlstate_of(v_admin, format(
    'select public.reassign_actions(array[%L]::uuid[], %L, ''CAM A offboarded'')',
    v_act_cross, v_cam_b));
  select assignee_user_id into v_assignee from public.actions where id = v_act_cross;
  return next is(v_assignee, v_cam_b,
    'reassign_actions moves admin-assigned work on another CAM''s client');

  select count(*) into v_count
    from public.audit_log
   where action = 'action_reassigned'
     and target_id = v_act_cross
     and detail->>'organisation_id' = v_org_y::text;
  return next is(v_count, 1::bigint,
    'the action audit row carries the client so the timeline can show it');

  -- Regression guard for the hole fixed in 20260803100000. The outgoing CAM raised this
  -- action and is still an active user, so nothing else in the policy stops them; only
  -- the assignee check does. A blocked DELETE raises nothing, so assert the row.
  perform tests.sqlstate_of(v_cam_a, format(
    'delete from public.actions where id = %L', v_act_open));
  select count(*) into v_count from public.actions where id = v_act_open;
  return next is(v_count, 1::bigint,
    'the outgoing CAM cannot delete open work that was reassigned away from them');

  return next ok(
    not has_function_privilege('anon',
      'public.reassign_ownership(uuid[], uuid, text, uuid)', 'EXECUTE'),
    'anon holds no EXECUTE on reassign_ownership'
  );
end;
$$;

-- ---------------------------------------------------------------------------

select * from tests.suite_core();
select * from tests.suite_viewer();
select * from tests.suite_users();
select * from tests.suite_sensitive();
select * from tests.suite_audit();
select * from tests.suite_role_rpc();
select * from tests.suite_views();
select * from tests.suite_actions();
select * from tests.suite_reassign();

select * from finish();

rollback;
