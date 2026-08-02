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
-- Suspend / reactivate RPC — F013 (#15)
-- ---------------------------------------------------------------------------
-- users.is_active is granted to nobody, so set_user_active is the only write-path.
-- These assert the three things the story turns on: an admin can flip it, a non-admin
-- cannot, and the flag actually revokes access rather than merely recording a state.
create or replace function tests.suite_active_rpc()
returns setof text language plpgsql as $$
declare
  v_admin   uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a   uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b   uuid := '00000000-0000-4000-a000-000000000003';
  v_active  boolean;
  v_count   bigint;
begin
  if to_regprocedure('public.set_user_active(uuid, boolean)') is null then
    return next skip(10, 'set_user_active RPC not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- AC2: the suspension must sign them out, not merely deny them. Give cam_b a
  -- session first so there is something for the suspension to revoke — without this
  -- fixture the assertion below passes against a database that revokes nothing.
  --
  -- This is the shape of the bug it exists to catch: the original implementation
  -- called auth-js `admin.signOut(userId)`, which wanted a JWT, failed on every call,
  -- and left the session alive while the UI reported success with a warning.
  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (gen_random_uuid(), v_cam_b, now(), now());
  select count(*) into v_count from auth.sessions where user_id = v_cam_b;
  return next is(v_count, 1::bigint, 'the fixture session exists before suspension');

  -- Admin suspends a CAM.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_user_active(%L, false)', v_cam_b)),
    null,
    'admin can suspend another user via the RPC'
  );
  select is_active into v_active from public.users where id = v_cam_b;
  return next is(v_active, false, 'the suspension actually landed');

  select count(*) into v_count from auth.sessions where user_id = v_cam_b;
  return next is(v_count, 0::bigint,
    'suspension revoked the user''s sessions, not just their permissions');

  -- AC3: suspension leaves owned rows alone. The seed gives cam_b an organisation;
  -- it must still be theirs, so reactivation or F257 reassignment has something to
  -- work with.
  if tests.tables_exist('organisations') then
    select count(*) into v_count
      from public.organisations where owner_id = v_cam_b;
    return next is(v_count, 1::bigint,
      'suspension does not release the user''s owned organisations');
  else
    return next skip(1, 'organisations not yet migrated');
  end if;

  if tests.tables_exist('audit_log') then
    select count(*) into v_count
      from public.audit_log
     where action = 'user_suspended' and target_id = v_cam_b;
    return next is(v_count, 1::bigint,
      'the suspension wrote exactly one audit_log row');
  else
    return next skip(1, 'audit_log not yet migrated');
  end if;

  -- The flag is not decorative: a suspended user reads nothing. Every policy gates on
  -- app.is_active_user(), so their own directory SELECT now returns zero rows.
  perform tests.login_as(v_cam_b);
  select count(*) into v_count from public.users;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint,
    'a suspended user can no longer read the team directory');

  -- Reactivation is reversible and audited under its own action name (AC4).
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_user_active(%L, true)', v_cam_b)),
    null,
    'admin can reverse a suspension'
  );

  -- A CAM cannot call it, even though EXECUTE is granted to authenticated — the body
  -- self-checks is_admin().
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_user_active(%L, false)', v_cam_b)),
    '42501',
    'CAM calling the access RPC is refused inside the SECURITY DEFINER body'
  );

  -- Self-suspension is refused. This is also what guarantees an active admin always
  -- survives: the only person an admin cannot suspend is themselves, so the caller is
  -- always a remaining admin.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_user_active(%L, false)', v_admin)),
    '42501',
    'an admin cannot suspend their own account'
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
-- Raw ingestion layer — matrix §3.5 (F038, step 6.0 create_ingestion)
--
-- suite_sensitive already covers the headline check (a CAM reads zero raw source
-- records). This is the rest of the §3.5 row: that an admin *can* read what the CAM
-- cannot — a policy that returns zero rows to everyone would pass the sensitive
-- check while being useless — plus the write verbs, which no test covered.
-- ---------------------------------------------------------------------------

create or replace function tests.suite_ingestion()
returns setof text language plpgsql as $$
declare
  v_admin  uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a  uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer uuid := '00000000-0000-4000-a000-000000000005';
  v_run    uuid := '00000000-0000-4000-c000-000000000001';
  v_record uuid := '00000000-0000-4000-c000-000000000002';
  v_count  bigint;
  v_state  text;
begin
  if not tests.tables_exist('users') then
    return next skip(1, 'step 2 create_users not yet migrated');
    return;
  end if;

  if not tests.tables_exist('ingestion_runs', 'raw_source_records') then
    return next skip(8, 'step 6 create_ingestion not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Fixtures are inserted as the table owner, which bypasses RLS — the point of the
  -- suite is what the *end-user* roles can then see of them.
  insert into public.ingestion_runs (id, api_source, triggered_by, job_status)
  values (v_run, 'companies_house', 'manual', 'completed')
  on conflict (id) do nothing;

  insert into public.raw_source_records
    (id, ingestion_run_id, record_source, source_record_id, raw_payload, checksum)
  values
    (v_record, v_run, 'companies_house', '00000001', '{"company_number":"00000001"}'::jsonb, 'deadbeef')
  on conflict (id) do nothing;

  -- SELECT: admin yes, everyone else no.
  perform tests.login_as(v_admin);
  select count(*) into v_count from public.ingestion_runs where id = v_run;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 1::bigint, 'admin reads ingestion runs');

  perform tests.login_as(v_admin);
  select count(*) into v_count from public.raw_source_records where id = v_record;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 1::bigint,
    'admin reads raw source records the CAM cannot');

  perform tests.login_as(v_cam_a);
  select count(*) into v_count from public.ingestion_runs;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'CAM sees zero ingestion runs');

  perform tests.login_as(v_viewer);
  select count(*) into v_count from public.raw_source_records;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'viewer sees zero raw source records');

  -- INSERT on ingestion_runs is admin-only, so a CAM triggering a run is refused.
  v_state := tests.sqlstate_of(v_cam_a,
    'insert into public.ingestion_runs (api_source, triggered_by) '
    'values (''companies_house'', ''manual'')');
  return next is(v_state, '42501', 'CAM cannot record an ingestion run');

  -- No UPDATE policy or grant on raw_source_records for any end-user role: the raw
  -- layer is append-only to everyone but service_role. Even an admin is refused.
  v_state := tests.sqlstate_of(v_admin, format(
    'update public.raw_source_records set processing_status = ''rejected'' where id = %L',
    v_record));
  return next is(v_state, '42501', 'not even an admin can edit a raw payload');

  -- DELETE is admin-only (§3.5): the CAM's attempt leaves the row, the admin's removes it.
  perform tests.sqlstate_of(v_cam_a, format(
    'delete from public.raw_source_records where id = %L', v_record));
  select count(*) into v_count from public.raw_source_records where id = v_record;
  return next is(v_count, 1::bigint, 'CAM cannot delete a raw source record');

  perform tests.sqlstate_of(v_admin, format(
    'delete from public.raw_source_records where id = %L', v_record));
  select count(*) into v_count from public.raw_source_records where id = v_record;
  return next is(v_count, 0::bigint, 'admin can delete a raw source record');
end;
$$;

-- ---------------------------------------------------------------------------

select * from tests.suite_core();
select * from tests.suite_viewer();
select * from tests.suite_users();
select * from tests.suite_sensitive();
select * from tests.suite_ingestion();
select * from tests.suite_audit();
select * from tests.suite_role_rpc();
select * from tests.suite_active_rpc();
select * from tests.suite_views();

select * from finish();

rollback;
