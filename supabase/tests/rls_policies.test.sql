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

-- The same guard one level down, for a suite that tests columns added to a table
-- another migration created. tables_exist would pass on F036's table alone and the
-- F037 suite would then fail with "column does not exist" instead of skipping.
create or replace function tests.columns_exist(p_table text, variadic p_columns text[])
returns boolean language plpgsql stable as $$
declare c text;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    return false;
  end if;
  foreach c in array p_columns loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = p_table and column_name = c
    ) then
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
  v_org_cam_a   uuid := '00000000-0000-4000-b000-000000000002';
  v_org_cam_b   uuid := '00000000-0000-4000-b000-000000000003';
  v_count       bigint;
  v_ok          boolean;
  v_owner       uuid;
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

    -- Ownership (F162, since 20260806140000): a CAM claiming an unowned organisation
    -- is RPC-only now (suite_claim_ownership below). A direct UPDATE raises nothing —
    -- it is blocked by USING, not WITH CHECK — so it must be asserted on the resulting
    -- row, not the SQLSTATE (same lesson as the role-escalation check above).
    perform tests.sqlstate_of(v_cam_a, format(
      'update public.organisations set owner_id = %L where id = %L', v_cam_a, v_org_unowned));
    select owner_id into v_owner from public.organisations where id = v_org_unowned;
    return next is(v_owner, null::uuid,
      'a direct UPDATE no longer lets a CAM claim an unowned organisation; claim_organisation() is the only path'
    );

    -- ...and may not hand one they own to another user — this needs an actually-owned
    -- row (v_org_unowned stays unowned now claiming it is RPC-only, see above), so the
    -- WITH CHECK violation (not a USING-filtered no-op) is what fires here.
    return next is(
      tests.sqlstate_of(v_cam_a, format(
        'update public.organisations set owner_id = %L where id = %L', v_cam_b, v_org_cam_a)),
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
    return next skip(7, 'set_user_role RPC not yet migrated');
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

  -- Matrix §6 gap 7 regression check: demoting cam_b (now admin, from above) back
  -- down is a legitimate multi-admin operation and must still succeed — the new
  -- guard only refuses a change when NO other active admin would remain. This
  -- cannot exercise the guard actually firing: reaching it requires the caller to
  -- be a distinct active admin from the target, which structurally means the
  -- caller always survives a solo call. Proof the guard fires under real
  -- concurrency lives in scripts/verify-last-admin-guard.mts, not here.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_user_role(%L, ''cam'')', v_cam_b)),
    null,
    'admin demoting a second admin still succeeds while another admin remains'
  );
  select role::text into v_role from public.users where id = v_cam_b;
  return next is(v_role, 'cam', 'the demotion actually landed');

  select count(*) into v_count
    from public.users where role = 'admin' and is_active;
  return next is(v_count, 1::bigint,
    'exactly one active admin remains after the demotion (never zero)');
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
    return next skip(13, 'set_user_active RPC not yet migrated');
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

  -- Matrix §6 gap 7 regression check: suspending an admin who is not the last one
  -- must still succeed. Promoted directly (bypassing RLS, same as the fixtures
  -- above) rather than via set_user_role, so this suite does not depend on
  -- suite_role_rpc having run first. As with suite_role_rpc's regression check,
  -- this cannot exercise the guard actually firing — see that comment for why.
  update public.users set role = 'admin' where id = v_cam_a;
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_user_active(%L, false)', v_cam_a)),
    null,
    'admin suspending a second admin still succeeds while another admin remains'
  );
  select is_active into v_active from public.users where id = v_cam_a;
  return next is(v_active, false, 'the suspension actually landed');

  select count(*) into v_count
    from public.users where role = 'admin' and is_active;
  return next is(v_count, 1::bigint,
    'exactly one active admin remains after the suspension (never zero)');
end;
$$;

-- ---------------------------------------------------------------------------
-- Deactivate (offboard) RPC — F014 (#16)
-- ---------------------------------------------------------------------------
-- Deactivation is suspension plus offboarding: the account closes and its clients go
-- somewhere. The assertions that matter are the ones a reviewer cannot check by
-- reading the function — that the gate actually refuses while clients are owned, that
-- the transfer and the closure land in the same transaction, and that nothing is
-- deleted (AC3, AC4).
--
-- The target is v_deactivated (fixture id ...004) rather than a CAM the earlier suites
-- rely on. Every suite runs inside the one uncommitted transaction with no reset
-- between them, so deactivating cam_a or cam_b here would change the world underneath
-- whatever runs next. ...004 is already is_active = false with no deactivated_at,
-- which is exactly the suspended-not-deactivated state, and the fixture org below is
-- created locally for the same isolation reason.
create or replace function tests.suite_deactivate_rpc()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer      uuid := '00000000-0000-4000-a000-000000000005';
  v_target      uuid := '00000000-0000-4000-a000-000000000004';
  v_org         uuid := '00000000-0000-4000-b000-000000000004';
  v_deactivated timestamptz;
  v_active      boolean;
  v_owner       uuid;
  v_count       bigint;
begin
  if to_regprocedure('public.deactivate_user(uuid, text, uuid, boolean)') is null then
    return next skip(23, 'deactivate_user RPC not yet migrated');
    return;
  end if;

  perform tests.seed();

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values (v_org, 'Offboarding Org Ltd', 'manual', 'other', v_target)
  on conflict (id) do update set owner_id = excluded.owner_id;

  -- Seeded so the revocation assertion further down has something to revoke. This
  -- migration replaces set_user_active with `create or replace`, which silently wins
  -- over the two earlier definitions; if a future edit forgets to carry the
  -- app.revoke_sessions call forward, this is what fails.
  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (gen_random_uuid(), v_target, now(), now());

  -- Authorisation, re-checked inside the SECURITY DEFINER body: EXECUTE is granted to
  -- `authenticated`, which every signed-in user shares, so the body is the only thing
  -- standing between a CAM and an offboarding.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.deactivate_user(%L, %L, %L, false)', v_target, 'leaving', v_cam_a)),
    '42501',
    'CAM calling deactivate_user is refused inside the SECURITY DEFINER body'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, false)', v_admin, 'leaving')),
    '42501',
    'an admin cannot deactivate their own account'
  );

  -- PRD §4.2: the reason is required, and whitespace is not a reason.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, %L, false)', v_target, '   ', v_cam_a)),
    '22023',
    'a blank reason is refused'
  );

  -- AC2, the gate. This is the assertion the story turns on: while the user owns
  -- clients and no destination is given, the account does not close.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, false)', v_target, 'leaving')),
    '22023',
    'deactivation is refused while the user still owns clients'
  );
  select deactivated_at into v_deactivated from public.users where id = v_target;
  return next is(v_deactivated, null::timestamptz,
    'the refused deactivation left the account untouched');

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, %L, false)', v_target, 'leaving', v_viewer)),
    '22023',
    'clients cannot be reassigned to a viewer'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, %L, true)', v_target, 'leaving', v_cam_a)),
    '22023',
    'naming an owner and releasing to the pool at the same time is refused'
  );

  -- The whole thing, for real.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, %L, false)', v_target, 'left the society', v_cam_a)),
    null,
    'admin can deactivate a user and hand their clients on'
  );

  select is_active, deactivated_at into v_active, v_deactivated
    from public.users where id = v_target;
  return next ok(v_active = false and v_deactivated is not null,
    'the account is inactive and marked as deactivated, not merely suspended');

  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, v_cam_a,
    'the owned client moved to the named CAM in the same transaction');

  select count(*) into v_count from auth.sessions where user_id = v_target;
  return next is(v_count, 0::bigint,
    'deactivation revoked the offboarded user''s sessions');

  -- AC3/AC4: deactivation is not deletion. The row survives, and so does the trail.
  select count(*) into v_count from public.users where id = v_target;
  return next is(v_count, 1::bigint, 'the user row is not deleted');

  if tests.tables_exist('audit_log') then
    select count(*) into v_count
      from public.audit_log
     where action = 'user_deactivated' and target_id = v_target;
    return next is(v_count, 1::bigint,
      'exactly one user_deactivated audit row, and only for the successful attempt');

    select count(*) into v_count
      from public.audit_log
     where action = 'ownership_reassigned'
       and target_table = 'organisations'
       and target_id = v_org
       and detail->>'reason' = 'left the society';
    return next is(v_count, 1::bigint,
      'the client handover is audited against the organisation, carrying the reason');
  else
    return next skip(2, 'audit_log not yet migrated');
  end if;

  -- Pressing the button twice does not produce a second audit row or a second sweep.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, false)', v_target, 'again')),
    null,
    'deactivating an already-deactivated user is a no-op, not an error'
  );

  -- Reactivation has to clear the marker or the constraint rejects it outright. This
  -- is the assertion that would have caught shipping F014 without amending F013.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_user_active(%L, true)', v_target)),
    null,
    'a deactivated user can be reactivated'
  );
  select deactivated_at into v_deactivated from public.users where id = v_target;
  return next is(v_deactivated, null::timestamptz,
    'reactivation clears the deactivation marker');

  -- The illegal combination is forbidden by the database, not by the RPCs. Asserted as
  -- the table owner, which is the only role that could ever write the column directly.
  return next throws_ok(
    format('update public.users set deactivated_at = now() where id = %L', v_cam_a),
    '23514',
    null,
    'an active user cannot carry a deactivation timestamp'
  );

  -- The other destination PRD §6.12 allows: back to the unowned pool.
  update public.organisations set owner_id = v_target where id = v_org;
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, true)', v_target, 'released')),
    null,
    'clients can be released to the unowned pool instead of being reassigned'
  );
  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, null::uuid,
    'the released client is unowned and claimable by any CAM'
  );

  -- Matrix §6 gap 7 regression check: deactivate_user is the third writer of
  -- is_active, so it takes the same guard. Deactivating an admin who is not the last
  -- one must still succeed. As in suite_role_rpc and suite_active_rpc, this cannot
  -- exercise the guard actually firing — reaching it requires the caller to be a
  -- distinct active admin from the target, which structurally means the caller always
  -- survives a solo call. Proof it fires under real concurrency lives in
  -- scripts/verify-last-admin-guard.mts.
  update public.users
     set role = 'admin', is_active = true, deactivated_at = null
   where id = v_target;
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, true)', v_target, 'second admin')),
    null,
    'admin deactivating a second admin still succeeds while another admin remains'
  );
  select is_active into v_active from public.users where id = v_target;
  return next is(v_active, false, 'the deactivation actually landed');

  select count(*) into v_count
    from public.users where role = 'admin' and is_active;
  return next is(v_count, 1::bigint,
    'exactly one active admin remains after the deactivation (never zero)');

  -- Leave the fixture as it was found: later suites share this transaction. Restored
  -- with plain SQL rather than the RPCs — those self-check app.is_admin(), which reads
  -- auth.uid(), and here there is no signed-in user to be an admin.
  update public.users
     set role = 'cam', is_active = false, deactivated_at = null
   where id = v_target;
  delete from public.organisations where id = v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deactivate (offboard) RPC — F014 (#16)
-- ---------------------------------------------------------------------------
-- Deactivation is suspension plus offboarding: the account closes and its clients go
-- somewhere. The assertions that matter are the ones a reviewer cannot check by
-- reading the function — that the gate actually refuses while clients are owned, that
-- the transfer and the closure land in the same transaction, and that nothing is
-- deleted (AC3, AC4).
--
-- The target is v_deactivated (fixture id ...004) rather than a CAM the earlier suites
-- rely on. Every suite runs inside the one uncommitted transaction with no reset
-- between them, so deactivating cam_a or cam_b here would change the world underneath
-- whatever runs next. ...004 is already is_active = false with no deactivated_at,
-- which is exactly the suspended-not-deactivated state, and the fixture org below is
-- created locally for the same isolation reason.
create or replace function tests.suite_deactivate_rpc()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer      uuid := '00000000-0000-4000-a000-000000000005';
  v_target      uuid := '00000000-0000-4000-a000-000000000004';
  v_org         uuid := '00000000-0000-4000-b000-000000000004';
  v_deactivated timestamptz;
  v_active      boolean;
  v_owner       uuid;
  v_count       bigint;
begin
  if to_regprocedure('public.deactivate_user(uuid, text, uuid, boolean)') is null then
    return next skip(20, 'deactivate_user RPC not yet migrated');
    return;
  end if;

  perform tests.seed();

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values (v_org, 'Offboarding Org Ltd', 'manual', 'other', v_target)
  on conflict (id) do update set owner_id = excluded.owner_id;

  -- Seeded so the revocation assertion further down has something to revoke. This
  -- migration replaces set_user_active with `create or replace`, which silently wins
  -- over the two earlier definitions; if a future edit forgets to carry the
  -- app.revoke_sessions call forward, this is what fails.
  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (gen_random_uuid(), v_target, now(), now());

  -- Authorisation, re-checked inside the SECURITY DEFINER body: EXECUTE is granted to
  -- `authenticated`, which every signed-in user shares, so the body is the only thing
  -- standing between a CAM and an offboarding.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.deactivate_user(%L, %L, %L, false)', v_target, 'leaving', v_cam_a)),
    '42501',
    'CAM calling deactivate_user is refused inside the SECURITY DEFINER body'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, false)', v_admin, 'leaving')),
    '42501',
    'an admin cannot deactivate their own account'
  );

  -- PRD §4.2: the reason is required, and whitespace is not a reason.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, %L, false)', v_target, '   ', v_cam_a)),
    '22023',
    'a blank reason is refused'
  );

  -- AC2, the gate. This is the assertion the story turns on: while the user owns
  -- clients and no destination is given, the account does not close.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, false)', v_target, 'leaving')),
    '22023',
    'deactivation is refused while the user still owns clients'
  );
  select deactivated_at into v_deactivated from public.users where id = v_target;
  return next is(v_deactivated, null::timestamptz,
    'the refused deactivation left the account untouched');

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, %L, false)', v_target, 'leaving', v_viewer)),
    '22023',
    'clients cannot be reassigned to a viewer'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, %L, true)', v_target, 'leaving', v_cam_a)),
    '22023',
    'naming an owner and releasing to the pool at the same time is refused'
  );

  -- The whole thing, for real.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, %L, false)', v_target, 'left the society', v_cam_a)),
    null,
    'admin can deactivate a user and hand their clients on'
  );

  select is_active, deactivated_at into v_active, v_deactivated
    from public.users where id = v_target;
  return next ok(v_active = false and v_deactivated is not null,
    'the account is inactive and marked as deactivated, not merely suspended');

  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, v_cam_a,
    'the owned client moved to the named CAM in the same transaction');

  select count(*) into v_count from auth.sessions where user_id = v_target;
  return next is(v_count, 0::bigint,
    'deactivation revoked the offboarded user''s sessions');

  -- AC3/AC4: deactivation is not deletion. The row survives, and so does the trail.
  select count(*) into v_count from public.users where id = v_target;
  return next is(v_count, 1::bigint, 'the user row is not deleted');

  if tests.tables_exist('audit_log') then
    select count(*) into v_count
      from public.audit_log
     where action = 'user_deactivated' and target_id = v_target;
    return next is(v_count, 1::bigint,
      'exactly one user_deactivated audit row, and only for the successful attempt');

    select count(*) into v_count
      from public.audit_log
     where action = 'ownership_reassigned'
       and target_table = 'organisations'
       and target_id = v_org
       and detail->>'reason' = 'left the society';
    return next is(v_count, 1::bigint,
      'the client handover is audited against the organisation, carrying the reason');
  else
    return next skip(2, 'audit_log not yet migrated');
  end if;

  -- Pressing the button twice does not produce a second audit row or a second sweep.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, false)', v_target, 'again')),
    null,
    'deactivating an already-deactivated user is a no-op, not an error'
  );

  -- Reactivation has to clear the marker or the constraint rejects it outright. This
  -- is the assertion that would have caught shipping F014 without amending F013.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_user_active(%L, true)', v_target)),
    null,
    'a deactivated user can be reactivated'
  );
  select deactivated_at into v_deactivated from public.users where id = v_target;
  return next is(v_deactivated, null::timestamptz,
    'reactivation clears the deactivation marker');

  -- The illegal combination is forbidden by the database, not by the RPCs. Asserted as
  -- the table owner, which is the only role that could ever write the column directly.
  return next throws_ok(
    format('update public.users set deactivated_at = now() where id = %L', v_cam_a),
    '23514',
    null,
    'an active user cannot carry a deactivation timestamp'
  );

  -- The other destination PRD §6.12 allows: back to the unowned pool.
  update public.organisations set owner_id = v_target where id = v_org;
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.deactivate_user(%L, %L, null, true)', v_target, 'released')),
    null,
    'clients can be released to the unowned pool instead of being reassigned'
  );
  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, null::uuid,
    'the released client is unowned and claimable by any CAM'
  );

  -- Leave the fixture as it was found: later suites share this transaction. Restored
  -- with plain SQL rather than the RPCs — those self-check app.is_admin(), which reads
  -- auth.uid(), and here there is no signed-in user to be an admin.
  update public.users
     set is_active = false, deactivated_at = null
   where id = v_target;
  delete from public.organisations where id = v_org;
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
-- The fixture is local to this suite rather than reusing the shared 'Unowned Org
-- Ltd', so this suite's assertions do not depend on what state an earlier suite left
-- it in — every suite runs in one uncommitted transaction with no reset in between.

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
  -- taken the CAM's claim path with it. Since F162 (20260806140000) that path is
  -- claim_organisation(), not a direct UPDATE — suite_claim_ownership covers it in
  -- depth; this re-checks it still works on a row whose state this suite controls.
  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.claim_organisation(%L)', v_org)),
    null,
    'CAM can still claim an unowned organisation after the viewer lockout'
  );
  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, v_cam_a,
    'the claim actually took — not just an unraised no-op');
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
-- Accept-invite RPC — F008 (#8)
-- ---------------------------------------------------------------------------
-- users.invite_accepted_at is granted to nobody, so mark_invite_accepted is the only
-- write-path. What the story turns on: an invitee can accept their own invite exactly
-- once, and the call is harmless for everyone else — the password-reset action calls
-- it on every reset, invitee or not.
create or replace function tests.suite_invite_rpc()
returns setof text language plpgsql as $$
declare
  v_cam_a uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000003';
  v_accepted timestamptz;
  v_count bigint;
begin
  if to_regprocedure('public.mark_invite_accepted()') is null then
    return next skip(6, 'mark_invite_accepted RPC not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- CAM B stands in for the invited person: invited, not yet accepted.
  update public.users
  set invited_at = now(), invite_accepted_at = null
  where id = v_cam_b;

  return next is(
    tests.sqlstate_of(v_cam_b, 'select public.mark_invite_accepted()'),
    null,
    'an invited user can accept their own invite'
  );
  select invite_accepted_at into v_accepted from public.users where id = v_cam_b;
  return next isnt(v_accepted, null, 'accepting the invite stamped invite_accepted_at');

  -- Accepting twice must not produce a second transition — the password form calls
  -- this on every reset, including resets by someone who accepted months ago.
  return next is(
    tests.sqlstate_of(v_cam_b, 'select public.mark_invite_accepted()'),
    null,
    'calling it again is accepted rather than erroring'
  );

  -- Someone who was never invited (a plain password reset) is untouched, and
  -- crucially writes no audit row — it is not a transition.
  return next is(
    tests.sqlstate_of(v_cam_a, 'select public.mark_invite_accepted()'),
    null,
    'a user with no pending invite may call it harmlessly'
  );
  select invite_accepted_at into v_accepted from public.users where id = v_cam_a;
  return next is(v_accepted, null, 'a user with no invite is not marked as accepted');

  if tests.tables_exist('audit_log') then
    select count(*) into v_count
      from public.audit_log
     where action = 'invite_accepted' and target_id = v_cam_b;
    return next is(v_count, 1::bigint,
      'acceptance wrote exactly one audit_log row, and the no-ops wrote none');
  else
    return next skip(1, 'audit_log not yet migrated');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-up domain guard — F008 (20260804160000_configurable_signup_domains)
-- ---------------------------------------------------------------------------
-- This is a security boundary, and the interesting cases are the ones that must
-- keep failing. Inserts go directly into auth.users, which is what the trigger
-- fires on — the same door the admin API and any raw SQL go through.
create or replace function tests.suite_signup_domain()
returns setof text language plpgsql as $$
declare
  v_new uuid;
begin
  if to_regprocedure('public.check_allowed_email_domain()') is null then
    return next skip(7, 'configurable signup domains not yet migrated');
    return;
  end if;

  return next ok(
    exists (select 1 from app.allowed_email_domains where domain = '180dc.org'),
    '180dc.org is seeded, so the previous rule still holds with no configuration'
  );

  -- The table is granted to nobody. A signed-in user reading it directly is the
  -- thing RLS-with-no-policies exists to stop.
  return next is(
    tests.sqlstate_of(
      '00000000-0000-4000-a000-000000000002'::uuid,
      'select count(*) from app.allowed_email_domains'
    ),
    '42501',
    'a CAM cannot read the domain list directly'
  );

  v_new := gen_random_uuid();
  return next lives_ok(
    format(
      $sql$insert into auth.users (id, instance_id, aud, role, email)
           values (%L, '00000000-0000-0000-0000-000000000000', 'authenticated',
                   'authenticated', 'permitted@180dc.org')$sql$,
      v_new
    ),
    'a seeded domain is accepted'
  );

  return next throws_ok(
    $sql$insert into auth.users (id, instance_id, aud, role, email)
         values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
                 'authenticated', 'authenticated', 'nope@example.com')$sql$,
    'P0001',
    null,
    'an unlisted domain is refused'
  );

  -- The old check was `ilike '%@180dc.org'`, which this address satisfies. The
  -- rewrite matches on the domain after the final '@' instead, so it does not.
  return next throws_ok(
    $sql$insert into auth.users (id, instance_id, aud, role, email)
         values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
                 'authenticated', 'authenticated', 'attacker@evil.com@180dc.org')$sql$,
    'P0001',
    null,
    'a suffix that merely ends in the domain is not a match'
  );

  -- Adding a domain is the whole point of the table; it must actually take effect
  -- without any function being redefined.
  insert into app.allowed_email_domains (domain, note)
  values ('example.com', 'pgTAP fixture');

  v_new := gen_random_uuid();
  return next lives_ok(
    format(
      $sql$insert into auth.users (id, instance_id, aud, role, email)
           values (%L, '00000000-0000-0000-0000-000000000000', 'authenticated',
                   'authenticated', 'tester@example.com')$sql$,
      v_new
    ),
    'a domain added to the table is accepted immediately'
  );

  -- Fails closed: with nothing permitted, nobody gets in. The opposite — an empty
  -- table meaning "no restriction" — is the bug this asserts against.
  delete from app.allowed_email_domains;
  return next throws_ok(
    $sql$insert into auth.users (id, instance_id, aud, role, email)
         values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
                 'authenticated', 'authenticated', 'anyone@180dc.org')$sql$,
    'P0001',
    null,
    'an empty table permits nothing, rather than everything'
  );

  -- Put it back. The whole file runs in ONE transaction, so the delete above is
  -- visible to every suite that follows — and any of them calling tests.seed()
  -- would have its auth.users inserts refused by the guard this suite just proved
  -- works. That is not a hypothetical: it took out suite_default_role.
  insert into app.allowed_email_domains (domain, note)
  values ('180dc.org', '180 Degrees Consulting. The permanent entry — do not remove.')
  on conflict (domain) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Default role on a new account — F017 (#20)
-- ---------------------------------------------------------------------------
-- F017 AC3: someone who accepts an invite is a CAM unless an admin says otherwise.
-- Nothing in the application decides this — app.handle_new_auth_user() inserts
-- (id, email, invited_by_user_id, invited_at) and leaves `role` alone, so the
-- column default in create_users is what actually assigns it. That makes the
-- default a behaviour worth pinning: change it to 'admin' and every invited person
-- silently becomes an administrator, with no code change to notice in review.
create or replace function tests.suite_default_role()
returns setof text language plpgsql as $$
declare
  v_admin   uuid := '00000000-0000-4000-a000-000000000001';
  v_invitee uuid := '00000000-0000-4000-a000-000000000009';
  v_role    public.user_role;
  v_active  boolean;
  v_invited timestamptz;
begin
  if to_regprocedure('app.handle_new_auth_user()') is null then
    return next skip(4, 'handle_new_auth_user not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Exactly what inviteUserByEmail produces: an auth user carrying the inviting
  -- admin's id in raw_user_meta_data (src/lib/auth/invite.ts). The trigger fires
  -- on this insert; no public.users row is written by hand.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (
    v_invitee, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'invited@180dc.org',
    jsonb_build_object('invited_by_user_id', v_admin::text)
  );

  select role, is_active, invited_at into v_role, v_active, v_invited
    from public.users where id = v_invitee;

  return next is(v_role, 'cam'::public.user_role,
    'an invited account defaults to CAM, not admin (F017 AC3)');
  return next is(v_active, true, 'an invited account is active on creation');
  return next isnt(v_invited, null,
    'the invite metadata marked the row as a pending invite');

  -- "unless an admin explicitly sets it to Admin" — the second half of AC3. The
  -- promotion path is the RPC, never a direct update (suite_role_rpc covers who
  -- may call it); here it only has to be true that the default is not a ceiling.
  if to_regprocedure('public.set_user_role(uuid, public.user_role)') is null then
    return next skip(1, 'set_user_role RPC not yet migrated');
  else
    perform tests.sqlstate_of(v_admin, format(
      'select public.set_user_role(%L, ''admin'')', v_invitee));

    select role into v_role from public.users where id = v_invitee;
    return next is(v_role, 'admin'::public.user_role,
      'an admin can promote the invited CAM explicitly');
  end if;
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
   where action = 'ownership_reassigned' and target_id = v_org_x
   order by created_at desc limit 1;

  return next is(v_actor, v_admin,
    'the audit row names the acting admin, not the incoming CAM');

  return next is(
    jsonb_build_object(
      'from', v_detail->>'from',
      'to',   v_detail->>'to',
      'why',  v_detail->>'reason',
      'src',  v_detail->>'trigger',
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
-- Assign Client Owner (F163) — the admin path through reassign_ownership, and the
-- direct owner_id UPDATE it replaces (20260810110000)
-- ---------------------------------------------------------------------------
create or replace function tests.suite_assign_client_owner()
returns setof text language plpgsql as $$
declare
  v_admin    uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a    uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b    uuid := '00000000-0000-4000-a000-000000000003';
  v_org      uuid := '00000000-0000-4000-d000-000000000003';
  v_owner    uuid;
  v_detail   jsonb;
begin
  if not tests.tables_exist('organisations', 'users', 'audit_log')
     or to_regprocedure('public.reassign_ownership(uuid[], uuid, text, uuid)') is null then
    return next skip(5, 'F163 assign-owner path not yet migrated');
    return;
  end if;

  perform tests.seed();

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values (v_org, 'Assign Owner Fixture Ltd', 'manual', 'other', null)
  on conflict (id) do update set owner_id = null;

  -- The gap this migration closes: 20260806140000 already removed a CAM's own
  -- direct-claim branch; this one removes the admin's, so no role can move owner_id
  -- outside claim_organisation/reassign_ownership. USING blocks this before WITH
  -- CHECK, same as the CAM case above, so assert the resulting row, not the SQLSTATE.
  perform tests.sqlstate_of(v_admin, format(
    'update public.organisations set owner_id = %L where id = %L', v_cam_a, v_org));
  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, null::uuid,
    'a direct UPDATE no longer lets an admin set owner_id; reassign_ownership is the only path'
  );

  return next ok(
    not has_column_privilege('authenticated', 'public.organisations', 'owner_id', 'UPDATE'),
    'authenticated holds no UPDATE privilege on organisations.owner_id'
  );
  return next ok(
    has_column_privilege('authenticated', 'public.organisations', 'legal_name', 'UPDATE'),
    'authenticated can still update other organisations columns (canonical editing works)'
  );

  -- The actual F163 flow: an admin assigns an unowned client to a CAM, from the
  -- client profile, no p_from_user_id (the client has no current owner to guard
  -- against). AC1/AC3.
  perform tests.sqlstate_of(v_admin, format(
    'select public.reassign_ownership(array[%L]::uuid[], %L, ''initial assignment'', null)',
    v_org, v_cam_a));
  select owner_id into v_owner from public.organisations where id = v_org;
  return next is(v_owner, v_cam_a, 'admin assigns an unowned client to a CAM via reassign_ownership');

  -- AC2: reassigning a client that already has an owner is not silent — it is
  -- audited with both the outgoing and incoming CAM, same shape whether the client
  -- started unowned or owned. The UI shows the conflict warning before this call;
  -- the audit row is what proves it actually happened.
  perform tests.sqlstate_of(v_admin, format(
    'select public.reassign_ownership(array[%L]::uuid[], %L, ''reassigning to CAM B'', null)',
    v_org, v_cam_b));
  -- Not `order by created_at desc`: both calls run in this same test transaction,
  -- so now() — and every audit row's created_at — is identical between them
  -- (Postgres freezes now() for the transaction's duration). The reason string is
  -- the only thing that tells the two rows apart here.
  select detail into v_detail
    from public.audit_log
   where action = 'ownership_reassigned'
     and target_id = v_org
     and detail->>'reason' = 'reassigning to CAM B';
  return next is(
    jsonb_build_object('from', v_detail->>'from', 'to', v_detail->>'to'),
    jsonb_build_object('from', v_cam_a::text, 'to', v_cam_b::text),
    'reassigning an already-owned client is audited with both the outgoing and incoming owner'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_organisation — a CAM taking ownership of an unowned client (F162)
-- ---------------------------------------------------------------------------
-- Own fixture organisations (e000 prefix) rather than the shared 'Unowned Org Ltd':
-- this suite needs to control exactly when a row is unowned, and other suites both
-- read and write that shared row in the same uncommitted transaction.
create or replace function tests.suite_claim_ownership()
returns setof text language plpgsql as $$
declare
  v_admin        uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a        uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b        uuid := '00000000-0000-4000-a000-000000000003';
  v_deactivated  uuid := '00000000-0000-4000-a000-000000000004';
  v_viewer       uuid := '00000000-0000-4000-a000-000000000005';
  v_org_unowned  uuid := '00000000-0000-4000-e000-000000000001';  -- claimed by CAM A below
  v_org_admin    uuid := '00000000-0000-4000-e000-000000000002';  -- claimed by an admin
  v_owner        uuid;
  v_count        bigint;
  v_actor        uuid;
  v_detail       jsonb;
begin
  if not tests.tables_exist('organisations', 'users', 'audit_log')
     or to_regprocedure('public.claim_organisation(uuid)') is null then
    return next skip(14, 'claim_organisation RPC not yet migrated');
    return;
  end if;

  perform tests.seed();

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    (v_org_unowned, 'Claimable Org Ltd', 'manual', 'other', null),
    (v_org_admin,   'Claimable By Admin Ltd', 'manual', 'other', null)
  on conflict (id) do update set owner_id = null;

  -- Permission paths first.
  return next is(
    tests.sqlstate_of(v_viewer, format(
      'select public.claim_organisation(%L)', v_org_unowned)),
    '42501',
    'viewer cannot claim client ownership'
  );

  return next is(
    tests.sqlstate_of(v_deactivated, format(
      'select public.claim_organisation(%L)', v_org_unowned)),
    '42501',
    'a deactivated user cannot claim client ownership'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.claim_organisation(%L)', 'ffffffff-ffff-4fff-afff-ffffffffffff'::uuid)),
    'P0002',
    'claiming a client that does not exist is a controlled not-found error'
  );

  -- The happy path.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.claim_organisation(%L)', v_org_unowned)),
    null,
    'a CAM can claim an unowned client'
  );

  select owner_id into v_owner from public.organisations where id = v_org_unowned;
  return next is(v_owner, v_cam_a, 'the client is now owned by the claiming CAM');

  select actor_user_id, detail into v_actor, v_detail
    from public.audit_log
   where action = 'ownership_reassigned' and target_id = v_org_unowned
   order by created_at desc limit 1;
  return next is(v_actor, v_cam_a, 'the audit row names the claiming CAM as actor');
  return next is(
    jsonb_build_object(
      'from',    v_detail->>'from',
      'to',      v_detail->>'to',
      'trigger', v_detail->>'trigger'),
    jsonb_build_object(
      'from',    null,
      'to',      v_cam_a::text,
      'trigger', 'self_claim'),
    'the audit row carries a null "from", the claiming CAM as "to", and trigger self_claim'
  );

  -- Idempotent: claiming a client you already own is not an error and not audited
  -- again, same convention as reassign_ownership's already-there skip (matrix §3.11).
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.claim_organisation(%L)', v_org_unowned)),
    null,
    're-claiming your own client is a no-op, not an error'
  );
  select count(*) into v_count
    from public.audit_log
   where action = 'ownership_reassigned' and target_id = v_org_unowned;
  return next is(v_count, 1::bigint, 'the no-op re-claim writes no second audit row');

  -- AC2: never silently override. CAM B must not be able to take it, and must not
  -- see the reassign_ownership 42501 (this is a conflict, not a permission failure)
  -- or a silent success.
  return next is(
    tests.sqlstate_of(v_cam_b, format(
      'select public.claim_organisation(%L)', v_org_unowned)),
    '55000',
    'a CAM cannot claim a client another CAM already owns — raised, not silently skipped'
  );
  select owner_id into v_owner from public.organisations where id = v_org_unowned;
  return next is(v_owner, v_cam_a,
    'the existing owner is unchanged after the blocked claim attempt');

  -- Admins can be client owners too (matrix: "clients can only be owned by a CAM or
  -- an admin", same rule reassign_ownership enforces on its incoming owner).
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.claim_organisation(%L)', v_org_admin)),
    null,
    'an admin can also claim an unowned client'
  );
  select owner_id into v_owner from public.organisations where id = v_org_admin;
  return next is(v_owner, v_admin, 'the client is now owned by the claiming admin');

  return next ok(
    not has_function_privilege('anon', 'public.claim_organisation(uuid)', 'EXECUTE'),
    'anon holds no EXECUTE on claim_organisation'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- set_outreach_status — the CRM pipeline status field (F145, #140)
-- ---------------------------------------------------------------------------
-- Own fixture organisation (f000 prefix) rather than a shared one, same reasoning
-- as suite_claim_ownership: this suite drives outreach_status through several
-- transitions and does not want another suite's writes in the same run.
create or replace function tests.suite_outreach_status()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b       uuid := '00000000-0000-4000-a000-000000000003';
  v_deactivated uuid := '00000000-0000-4000-a000-000000000004';
  v_viewer      uuid := '00000000-0000-4000-a000-000000000005';
  v_org_cam_a   uuid := '00000000-0000-4000-f000-000000000001';  -- owned by CAM A
  v_status      public.outreach_status;
  v_count       bigint;
  v_actor       uuid;
  v_detail      jsonb;
begin
  if not tests.tables_exist('organisations', 'users', 'audit_log')
     or to_regprocedure('public.set_outreach_status(uuid, public.outreach_status)') is null then
    return next skip(15, 'set_outreach_status RPC not yet migrated');
    return;
  end if;

  perform tests.seed();

  insert into public.organisations
    (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values
    (v_org_cam_a, 'Pipeline Test Org Ltd', 'manual', 'other', v_cam_a, 'not_contacted')
  on conflict (id) do update set owner_id = v_cam_a, outreach_status = 'not_contacted';

  -- A brand-new client defaults to not_contacted (F145 AC3 / F146), enforced by the
  -- column default rather than this RPC — asserted here so a future migration that
  -- drops the default is caught by the same suite that exercises the enum.
  select outreach_status into v_status from public.organisations where id = v_org_cam_a;
  return next is(v_status, 'not_contacted'::public.outreach_status,
    'a freshly inserted client defaults to not_contacted');

  -- Permission paths first.
  return next is(
    tests.sqlstate_of(v_viewer, format(
      'select public.set_outreach_status(%L, ''responded'')', v_org_cam_a)),
    '42501',
    'viewer cannot change pipeline status'
  );

  return next is(
    tests.sqlstate_of(v_deactivated, format(
      'select public.set_outreach_status(%L, ''responded'')', v_org_cam_a)),
    '42501',
    'a deactivated user cannot change pipeline status'
  );

  return next is(
    tests.sqlstate_of(v_cam_b, format(
      'select public.set_outreach_status(%L, ''responded'')', v_org_cam_a)),
    '42501',
    'a CAM who does not own this client cannot change its status'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_outreach_status(%L, ''responded'')',
      'ffffffff-ffff-4fff-afff-ffffffffffff'::uuid)),
    'P0002',
    'changing the status of a client that does not exist is a controlled not-found error'
  );

  -- The happy path: the owning CAM moves their own client through the pipeline.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status(%L, ''initial_outreach_sent'')', v_org_cam_a)),
    null,
    'the owning CAM can change their client''s pipeline status'
  );
  select outreach_status into v_status from public.organisations where id = v_org_cam_a;
  return next is(v_status, 'initial_outreach_sent'::public.outreach_status,
    'the status actually moved');

  select actor_user_id, detail into v_actor, v_detail
    from public.audit_log
   where action = 'status_changed' and target_id = v_org_cam_a
   order by created_at desc limit 1;
  return next is(v_actor, v_cam_a, 'the audit row names the CAM who made the change');
  return next is(
    jsonb_build_object('from', v_detail->>'from', 'to', v_detail->>'to'),
    jsonb_build_object('from', 'not_contacted', 'to', 'initial_outreach_sent'),
    'the audit row carries the before and after status'
  );

  -- No-op: setting the same status again is not an error and is not audited again,
  -- same convention as claim_organisation's already-there skip.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status(%L, ''initial_outreach_sent'')', v_org_cam_a)),
    null,
    'setting the same status again is a no-op, not an error'
  );
  select count(*) into v_count
    from public.audit_log
   where action = 'status_changed' and target_id = v_org_cam_a;
  return next is(v_count, 1::bigint, 'the no-op re-set writes no second audit row');

  -- Admins can change any client's status, owned or not.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.set_outreach_status(%L, ''hard_no'')', v_org_cam_a)),
    null,
    'an admin can change the status of a client they do not own'
  );
  select outreach_status into v_status from public.organisations where id = v_org_cam_a;
  return next is(v_status, 'hard_no'::public.outreach_status,
    'the admin''s status change actually took');

  -- A direct write, bypassing the RPC, is exactly the gap audit-log-pattern.md and
  -- this migration close — asserted the same way the role-escalation check above
  -- does: on the resulting privilege, not just a query error.
  return next ok(
    not has_column_privilege('authenticated', 'public.organisations', 'outreach_status', 'UPDATE'),
    'authenticated holds no direct UPDATE privilege on organisations.outreach_status'
  );

  return next ok(
    not has_function_privilege(
      'anon', 'public.set_outreach_status(uuid, public.outreach_status)', 'EXECUTE'),
    'anon holds no EXECUTE on set_outreach_status'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- deactivate_user and reassign_ownership are one path (F014 + F257)
-- ---------------------------------------------------------------------------
-- Regression suite for 20260804170000. Before that migration deactivate_user moved
-- organisations.owner_id itself and never touched public.actions, so offboarding
-- stranded every open action on a closed account. Uses its own identities: the shared
-- fixture users are deactivated by other suites in this same transaction.

create or replace function tests.suite_offboard_unified()
returns setof text language plpgsql as $$
declare
  v_admin    uuid := '00000000-0000-4000-a000-0000000000f1';
  v_leaver   uuid := '00000000-0000-4000-a000-0000000000f2';
  v_taker    uuid := '00000000-0000-4000-a000-0000000000f3';
  v_other    uuid := '00000000-0000-4000-a000-0000000000f4';
  v_org_own  uuid := '00000000-0000-4000-b000-0000000000fa';  -- the leaver's client
  v_org_else uuid := '00000000-0000-4000-b000-0000000000fb';  -- someone else's client
  v_act_own  uuid := '00000000-0000-4000-c000-0000000000f1';  -- open, on their client
  v_act_stray uuid := '00000000-0000-4000-c000-0000000000f2'; -- open, on the other client
  v_owner    uuid;
  v_assignee uuid;
  v_active   boolean;
  v_count    bigint;
begin
  if not tests.tables_exist('actions', 'organisations', 'users', 'audit_log')
     or to_regprocedure('public.deactivate_user(uuid, text, uuid, boolean)') is null then
    return next skip(12, 'deactivate_user or actions not yet migrated');
    return;
  end if;

  insert into auth.users (id, instance_id, aud, role, email) values
    (v_admin,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','unify-admin@180dc.org'),
    (v_leaver, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','unify-leaver@180dc.org'),
    (v_taker,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','unify-taker@180dc.org'),
    (v_other,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','unify-other@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active) values
    (v_admin,  'unify-admin@180dc.org', 'Unify Admin',  'admin', true),
    (v_leaver, 'unify-leaver@180dc.org','Unify Leaver', 'cam',   true),
    (v_taker,  'unify-taker@180dc.org', 'Unify Taker',  'cam',   true),
    (v_other,  'unify-other@180dc.org', 'Unify Other',  'cam',   true)
  on conflict (id) do update
    set role = excluded.role, is_active = excluded.is_active;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    (v_org_own,  'Leaver Client Ltd', 'manual', 'other', v_leaver),
    (v_org_else, 'Other Client Ltd',  'manual', 'other', v_other)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.actions
    (id, organisation_id, assignee_user_id, created_by_user_id, title)
  values
    (v_act_own,   v_org_own,  v_leaver, v_leaver, 'Work on my own client'),
    (v_act_stray, v_org_else, v_leaver, v_admin,  'Admin-assigned work elsewhere')
  on conflict (id) do nothing;

  if tests.tables_exist('notes') then
    insert into public.notes (id, organisation_id, author_id, content)
    values ('00000000-0000-4000-c000-0000000000fe', v_org_own, v_leaver,
            'Spoke to the trustee; they want a proposal in September.')
    on conflict (id) do nothing;
  end if;

  if tests.tables_exist('outreach_messages', 'reply_events') then
    insert into public.outreach_messages
      (id, organisation_id, sent_by_user_id, subject, body, send_status)
    values ('00000000-0000-4000-c000-0000000000fd', v_org_own, v_leaver,
            'Partnership proposal', 'Half-written, saved for later.', 'draft')
    on conflict (id) do nothing;

    insert into public.reply_events
      (id, organisation_id, reply_body, received_at)
    values ('00000000-0000-4000-c000-0000000000fc', v_org_own,
            'Thanks, do send the proposal.', now())
    on conflict (id) do nothing;
  end if;

  perform tests.sqlstate_of(v_admin, format(
    'select public.deactivate_user(%L, ''left the society'', %L, false)',
    v_leaver, v_taker));

  select owner_id into v_owner from public.organisations where id = v_org_own;
  return next is(v_owner, v_taker, 'deactivation moves the leaver''s client to the successor');

  -- The regression. This assertion fails against the pre-20260804170000 function.
  select assignee_user_id into v_assignee from public.actions where id = v_act_own;
  return next is(v_assignee, v_taker,
    'deactivation moves the open action on that client, not just the client');

  select assignee_user_id into v_assignee from public.actions where id = v_act_stray;
  return next is(v_assignee, v_taker,
    'deactivation also moves admin-assigned work on someone else''s client');

  select owner_id into v_owner from public.organisations where id = v_org_else;
  return next is(v_owner, v_other,
    'the other CAM''s client is not seized while moving work off it');

  select is_active into v_active from public.users where id = v_leaver;
  return next is(v_active, false, 'the leaver is deactivated in the same transaction');

  select count(*) into v_count
    from public.audit_log
   where action = 'ownership_reassigned'
     and target_id = v_org_own
     and detail->>'trigger' = 'offboarding';
  return next is(v_count, 1::bigint,
    'one ownership_reassigned row per client, on the converged token');

  -- F257 AC4. Notes carry no owner column — they hang off organisation_id — so a
  -- handover should move them implicitly, with nothing in reassign_ownership naming
  -- them. This is the assertion that turns that from a design argument into a fact.
  if tests.tables_exist('notes') then
    select count(*) into v_count
      from public.notes where organisation_id = v_org_own and author_id = v_leaver;
    return next is(v_count, 1::bigint,
      'the leaver''s note is still attached to the client after the handover');

    -- Authorship is history and is never rewritten: the timeline must still say who
    -- wrote it, even though that person has left (matrix §3.11).
    select author_id into v_assignee
      from public.notes where organisation_id = v_org_own limit 1;
    return next is(v_assignee, v_leaver,
      'the note is still credited to the CAM who wrote it, not the successor');

    perform tests.login_as(v_taker);
    select count(*) into v_count from public.notes where organisation_id = v_org_own;
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
    return next is(v_count, 1::bigint,
      'the incoming CAM can read the departed CAM''s note on their new client');
  else
    return next skip(3, 'step 4 create_org_children not yet migrated');
  end if;

  -- F257 AC4 (drafts, replies) and AC8 (linked to the correct client and email
  -- record). Same principle as notes: these hang off organisation_id, so the handover
  -- moves them without reassign_ownership naming either table.
  if tests.tables_exist('outreach_messages', 'reply_events') then
    select count(*) into v_count
      from public.outreach_messages
     where organisation_id = v_org_own and send_status = 'draft';
    return next is(v_count, 1::bigint,
      'the leaver''s saved draft is still on the client after the handover');

    select sent_by_user_id into v_assignee
      from public.outreach_messages where organisation_id = v_org_own limit 1;
    return next is(v_assignee, v_leaver,
      'the draft is still attributed to the CAM who wrote it');

    -- Replies carry organisation_id of their own, so they stay with the client even
    -- though nothing in the handover looks at them.
    select count(*) into v_count
      from public.reply_events where organisation_id = v_org_own;
    return next is(v_count, 1::bigint,
      'a reply received before the handover is still attached to the client');
  else
    return next skip(3, 'steps 11/12 outreach tables not yet migrated');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- suppressions (F251, #82)
-- ---------------------------------------------------------------------------
-- Matrix §3.14. Uses the shared fixture's CAM A / CAM B organisations
-- (own-org requests) and the unowned one (admin direct-suppress).

create or replace function tests.suite_suppressions()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b       uuid := '00000000-0000-4000-a000-000000000003';
  v_viewer      uuid := '00000000-0000-4000-a000-000000000005';
  v_org_unowned uuid := '00000000-0000-4000-b000-000000000001';
  v_org_cam_a   uuid := '00000000-0000-4000-b000-000000000002';
  v_org_cam_b   uuid := '00000000-0000-4000-b000-000000000003';
  v_req_id      uuid;
  v_status      public.suppression_status;
  v_decided_by  uuid;
  v_requested_by uuid;
  v_reason      text;
  v_count       bigint;
  v_can_contact boolean;
begin
  if not tests.tables_exist('organisations', 'users', 'audit_log', 'suppressions')
     or to_regprocedure('public.request_suppression(uuid, text)') is null
     or to_regprocedure('public.decide_suppression_request(uuid, boolean, text)') is null
     or to_regprocedure('public.lift_suppression(uuid, text)') is null then
    return next skip(32, 'suppressions table or RPCs not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Table grants: every write is RPC-only (recipe step 4), same shape as audit_log.
  return next ok(
    not has_table_privilege('authenticated', 'public.suppressions', 'INSERT'),
    'authenticated holds no direct INSERT privilege on suppressions'
  );
  return next ok(
    not has_table_privilege('authenticated', 'public.suppressions', 'UPDATE'),
    'authenticated holds no direct UPDATE privilege on suppressions'
  );

  -- A viewer may not even request one.
  return next is(
    tests.sqlstate_of(v_viewer, format(
      'select public.request_suppression(%L, ''viewer trying to suppress'')', v_org_cam_a)),
    '42501',
    'viewer cannot call request_suppression'
  );

  -- A blank reason is rejected before a row is ever written.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.request_suppression(%L, ''   '')', v_org_cam_a)),
    '23514',
    'blank reason is rejected'
  );

  -- CAM A requests suppression of their own client. Lands pending, not active —
  -- only an admin decision (or an admin's own request) reaches active.
  perform tests.login_as(v_cam_a);
  select public.request_suppression(v_org_cam_a, 'Charity confirmed defunct by phone')
    into v_req_id;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select status, requested_by into v_status, v_requested_by
    from public.suppressions where id = v_req_id;
  return next is(v_status, 'pending'::public.suppression_status,
    'a CAM''s own request lands pending, not active');
  return next is(v_requested_by, v_cam_a, 'requested_by is the CAM who called it');

  select count(*) into v_count from public.audit_log
   where action = 'suppression_requested' and target_id = v_org_cam_a;
  return next is(v_count, 1::bigint, 'the request writes one suppression_requested audit row');

  -- CAM A cannot approve their own request — only an admin decides.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.decide_suppression_request(%L, true, null)', v_req_id)),
    '42501',
    'the requesting CAM cannot decide their own request'
  );

  -- A second open request for the same organisation is rejected while one is pending.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.request_suppression(%L, ''second attempt'')', v_org_cam_a)),
    '23505',
    'a duplicate open request for the same organisation is rejected'
  );

  -- Admin approves. Status moves to active, decided_by is recorded, and outreach is
  -- now blocked for everyone — admin included — until F185 lifts it.
  perform tests.login_as(v_admin);
  perform public.decide_suppression_request(v_req_id, true, 'confirmed with the trustee');
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select status, decided_by into v_status, v_decided_by
    from public.suppressions where id = v_req_id;
  return next is(v_status, 'active'::public.suppression_status,
    'admin approval moves the request to active');
  return next is(v_decided_by, v_admin, 'decided_by is the approving admin');

  select count(*) into v_count from public.audit_log
   where action = 'suppression_approved' and target_id = v_org_cam_a;
  return next is(v_count, 1::bigint, 'approval writes one suppression_approved audit row');

  select app.can_contact_organisation(v_org_cam_a) into v_can_contact;
  return next is(v_can_contact, false,
    'an active suppression blocks outreach via app.can_contact_organisation()');

  -- F050 (#52): the RLS layer itself, not just the helper function, must reject the
  -- insert — for both roles. outreach_messages_insert_admin used to skip this check
  -- entirely (fixed 20260806120000); assert both paths here so that bug can't recur.
  if tests.tables_exist('outreach_messages') then
    return next is(
      tests.sqlstate_of(v_cam_a, format(
        'insert into public.outreach_messages (organisation_id, sent_by_user_id, subject, body, send_status)
         values (%L, %L, ''s'', ''b'', ''draft'')', v_org_cam_a, v_cam_a)),
      '42501',
      'CAM cannot insert outreach_messages for a suppressed organisation'
    );
    return next is(
      tests.sqlstate_of(v_admin, format(
        'insert into public.outreach_messages (organisation_id, sent_by_user_id, subject, body, send_status)
         values (%L, %L, ''s'', ''b'', ''draft'')', v_org_cam_a, v_admin)),
      '42501',
      'admin cannot insert outreach_messages for a suppressed organisation either'
    );
  else
    return next skip(2, 'step 11 create_outreach not yet migrated');
  end if;

  -- Deciding an already-decided request is rejected, not silently re-applied.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.decide_suppression_request(%L, true, null)', v_req_id)),
    '55000',
    'deciding a request that is no longer pending is rejected'
  );

  -- CAM B's request gets rejected, and — unlike the duplicate-while-pending case
  -- above — a fresh request afterwards succeeds: 'rejected' is not an open status.
  perform tests.login_as(v_cam_b);
  select public.request_suppression(v_org_cam_b, 'Possible duplicate record')
    into v_req_id;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  perform tests.login_as(v_admin);
  perform public.decide_suppression_request(v_req_id, false, 'confirmed genuine, not a duplicate');
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select status into v_status from public.suppressions where id = v_req_id;
  return next is(v_status, 'rejected'::public.suppression_status,
    'admin rejection moves the request to rejected');

  select count(*) into v_count from public.audit_log
   where action = 'suppression_rejected' and target_id = v_org_cam_b;
  return next is(v_count, 1::bigint, 'rejection writes one suppression_rejected audit row');

  perform tests.login_as(v_cam_b);
  select public.request_suppression(v_org_cam_b, 'New complaint received') into v_req_id;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select status into v_status from public.suppressions where id = v_req_id;
  return next is(v_status, 'pending'::public.suppression_status,
    'a fresh request after a rejection is allowed (rejected is not an open status)');

  select count(*) into v_count from public.suppressions where organisation_id = v_org_cam_b;
  return next is(v_count, 2::bigint,
    'both the rejected and the new request survive — history is kept, not overwritten');

  -- An admin's own request self-approves: no admin ever waits on their own request.
  perform tests.login_as(v_admin);
  select public.request_suppression(v_org_unowned, 'Admin direct suppression') into v_req_id;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select status, requested_by, decided_by into v_status, v_requested_by, v_decided_by
    from public.suppressions where id = v_req_id;
  return next is(v_status, 'active'::public.suppression_status,
    'an admin''s own request lands active immediately, skipping pending');
  return next is(v_requested_by, v_admin, 'requested_by is the admin');
  return next is(v_decided_by, v_admin, 'decided_by is the same admin — self-approved');

  -- F185 Remove Suppression (#181)
  -- Non-admin cannot call lift_suppression
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.lift_suppression(%L, ''cam trying to unsuppress'')', v_req_id)),
    '42501',
    'CAM cannot call lift_suppression'
  );
  return next is(
    tests.sqlstate_of(v_viewer, format(
      'select public.lift_suppression(%L, ''viewer trying to unsuppress'')', v_req_id)),
    '42501',
    'viewer cannot call lift_suppression'
  );

  -- Blank reason is rejected
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.lift_suppression(%L, ''   '')', v_req_id)),
    '23514',
    'blank reason for lifting suppression is rejected'
  );

  -- Admin lifts the active suppression with a valid reason
  perform tests.login_as(v_admin);
  perform public.lift_suppression(v_req_id, 'Mistakenly flagged by CAM, re-contact approved');
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select status, decided_by, decision_note into v_status, v_decided_by, v_reason
    from public.suppressions where id = v_req_id;
  return next is(v_status, 'lifted'::public.suppression_status,
    'lifting suppression moves status to lifted');
  return next is(v_decided_by, v_admin, 'decided_by is updated to the lifting admin');
  return next is(v_reason, 'Mistakenly flagged by CAM, re-contact approved',
    'decision_note records the mandatory lift reason');

  select count(*) into v_count from public.audit_log
   where action = 'suppression_lifted' and target_id = v_org_unowned;
  return next is(v_count, 1::bigint, 'lifting writes one suppression_lifted audit row');

  select app.organisation_is_suppressed(v_org_unowned) into v_can_contact;
  return next is(v_can_contact, false,
    'organisation is no longer considered suppressed after lifting');

  perform tests.login_as(v_admin);
  select app.can_contact_organisation(v_org_unowned) into v_can_contact;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_can_contact, true,
    'lifting suppression re-enables outreach via app.can_contact_organisation()');
end;
$$;

-- ---------------------------------------------------------------------------
-- organisation source metadata (F043)
-- ---------------------------------------------------------------------------

create or replace function tests.suite_source_tracking()
returns setof text language plpgsql as $$
declare
  v_viewer uuid := '00000000-0000-4000-a000-000000000005';
  v_org    uuid := '00000000-0000-4000-b000-000000000001';
  v_run    uuid := '00000000-0000-4000-c000-000000000043';
  v_count  bigint;
begin
  if to_regprocedure('public.get_organisation_sources(uuid)') is null then
    return next skip(4, 'F043 source-tracking RPC not yet migrated');
    return;
  end if;

  perform tests.seed();

  return next ok(
    not has_function_privilege('anon', 'public.get_organisation_sources(uuid)', 'EXECUTE'),
    'anon cannot read organisation source metadata'
  );

  insert into public.ingestion_runs (id, api_source, triggered_by, job_status)
  values (v_run, 'companies_house', 'manual', 'completed')
  on conflict (id) do nothing;

  insert into public.raw_source_records (
    ingestion_run_id, record_source, source_record_id, raw_payload,
    matched_organisation_id, checksum
  ) values
    (v_run, 'companies_house', '01234567', '{}'::jsonb, v_org, 'f043-ch'),
    (v_run, 'charity_commission', '7654321', '{}'::jsonb, v_org, 'f043-cc')
  on conflict (record_source, source_record_id) do update
    set matched_organisation_id = excluded.matched_organisation_id;

  perform tests.login_as(v_viewer);
  select count(*) into v_count from public.get_organisation_sources(v_org);
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  return next is(v_count, 3::bigint,
    'an active viewer sees manual origin and every API contributor through safe metadata');

  update public.organisations set legal_name = legal_name || ' updated' where id = v_org;

  perform tests.login_as(v_viewer);
  select count(*) into v_count from public.get_organisation_sources(v_org);
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  return next is(v_count, 3::bigint,
    'source links persist after the canonical organisation is edited');

  return next is(
    tests.sqlstate_of(v_viewer, format(
      'select * from public.get_organisation_sources(%L)',
      'ffffffff-ffff-4fff-afff-ffffffffffff'::uuid)),
    'P0002',
    'an invalid organisation id returns a controlled not-found error'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- onboarding state (F255)
-- ---------------------------------------------------------------------------
-- Spec: docs/rls-permission-matrix.md §3.12. This is the one place in the schema
-- where a state-changing write is governed by RLS and a column grant rather than a
-- SECURITY DEFINER RPC, so the policies are the whole enforcement — there is no
-- function re-checking anything behind them. Two properties matter most: a CAM can
-- only ever write their own progress, and nobody can delete progress to walk a
-- dismissed guide back into view.

create or replace function tests.suite_onboarding()
returns setof text language plpgsql as $$
declare
  v_cam_a  uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b  uuid := '00000000-0000-4000-a000-000000000003';
  v_admin  uuid := '00000000-0000-4000-a000-000000000001';
  v_count  bigint;
  v_marker timestamptz;
begin
  if not tests.tables_exist('user_onboarding_steps') then
    return next skip(9, 'F255 onboarding state not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- The guide's own writes: a CAM records their own progress and reads it back.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.user_onboarding_steps (user_id, step_key) values (%L, %L)',
      v_cam_a, 'outreach_preferences')),
    null,
    'a CAM records their own completed step'
  );

  perform tests.login_as(v_cam_a);
  select count(*) into v_count from public.user_onboarding_steps;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 1::bigint, 'a CAM sees their own progress');

  -- The property the whole table hangs on: progress is per-user and unforgeable.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.user_onboarding_steps (user_id, step_key) values (%L, %L)',
      v_cam_b, 'outreach_preferences')),
    '42501',
    'a CAM cannot record progress on another CAM''s behalf'
  );

  perform tests.login_as(v_cam_b);
  select count(*) into v_count from public.user_onboarding_steps;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'a CAM cannot read another CAM''s progress');

  -- Admins are deliberately not granted a read here. F187 (admin views a CAM's
  -- settings) can add one with a stated reason when it is actually built; until
  -- then this asserts the absence is intentional rather than forgotten.
  perform tests.login_as(v_admin);
  select count(*) into v_count from public.user_onboarding_steps;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint,
    'an admin has no read on onboarding progress until F187 asks for one');

  -- Append-only. A user who could delete their own rows could make a dismissed
  -- guide reappear step by step, which is the failure AC5 exists to prevent.
  return next is(
    tests.sqlstate_of(v_cam_a,
      'delete from public.user_onboarding_steps'),
    '42501',
    'progress cannot be deleted, by its owner or anyone else'
  );

  return next is(
    tests.sqlstate_of(v_cam_a,
      'update public.user_onboarding_steps set completed_at = now()'),
    '42501',
    'progress cannot be rewritten after the fact'
  );

  -- The guide-level state on USERS: writable by its owner through the column grant
  -- added in 20260805100000, and by nobody else. The row policy
  -- (users_update_self_or_admin) is what confines it; the grant is what permits it
  -- at all.
  perform tests.login_as(v_cam_a);
  update public.users set onboarding_dismissed_at = now() where id = v_cam_a;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select onboarding_dismissed_at into v_marker from public.users where id = v_cam_a;
  return next ok(v_marker is not null, 'a CAM can dismiss their own guide');

  perform tests.login_as(v_cam_a);
  update public.users set onboarding_dismissed_at = now() where id = v_cam_b;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select onboarding_dismissed_at into v_marker from public.users where id = v_cam_b;
  -- A blocked UPDATE removes zero rows and raises nothing (§4), so this asserts the
  -- absence of the write rather than an error code.
  return next ok(v_marker is null, 'a CAM cannot dismiss another CAM''s guide');
end;
$$;

-- ---------------------------------------------------------------------------
-- client criteria review persistence (F047)
-- ---------------------------------------------------------------------------

create or replace function tests.suite_client_criteria()
returns setof text language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_cam uuid := '00000000-0000-4000-a000-000000000002';
  v_run uuid := '47000000-0000-4000-a000-000000000001';
  v_review uuid := '47000000-0000-4000-a000-000000000002';
  v_fail uuid := '47000000-0000-4000-a000-000000000003';
  v_flip uuid := '47000000-0000-4000-a000-000000000004';
  v_count bigint;
  v_detail jsonb;
  v_actor uuid;
  v_resolved boolean;
  v_events_before bigint;
begin
  if not tests.tables_exist('data_quality_events', 'raw_source_records', 'ingestion_runs') then
    return next skip(11, 'F047 data quality migration not yet applied');
    return;
  end if;
  perform tests.seed();

  return next ok(
    not has_function_privilege('authenticated',
      'public.record_client_criteria_outcome(uuid,text,text,text,text,boolean)', 'EXECUTE'),
    'authenticated users cannot forge client-criteria outcomes');

  insert into public.ingestion_runs (id, api_source, triggered_by, job_status)
  values (v_run, 'companies_house', 'manual', 'completed') on conflict (id) do nothing;
  insert into public.raw_source_records
    (id, ingestion_run_id, record_source, source_record_id, raw_payload, checksum)
  values
    (v_review, v_run, 'companies_house', 'f047-review', '{}'::jsonb, 'f047-review'),
    (v_fail, v_run, 'companies_house', 'f047-fail', '{}'::jsonb, 'f047-fail'),
    (v_flip, v_run, 'companies_house', 'f047-flip', '{}'::jsonb, 'f047-flip')
  on conflict (record_source, source_record_id) do nothing;

  perform public.record_client_criteria_outcome(
    v_review, 'needs_review', 'company', 'Needs social-purpose evidence.', 'standard', false);
  perform public.record_client_criteria_outcome(
    v_fail, 'does_not_meet', 'commercial', 'Outside configured criteria.', 'south_yorkshire', true);

  return next is((select rule_name from public.data_quality_events where raw_source_record_id = v_review),
    'client_criteria_needs_review', 'ambiguous candidates retain a queryable review flag');
  return next is((select rule_name from public.data_quality_events where raw_source_record_id = v_fail),
    'client_criteria_does_not_meet', 'definite failures retain a distinct queryable flag');

  -- AGENTS.md / docs/audit-log-pattern.md: excluding a record from the active
  -- client list is a status change and must be audited in the same transaction.
  select actor_user_id, detail into v_actor, v_detail
    from public.audit_log
   where action = 'client_criteria_rejected' and target_id = v_fail
   order by created_at desc limit 1;
  return next is(v_actor, null, 'the import pipeline has no end-user actor, so actor_user_id is null');
  return next is(
    jsonb_build_object('outcome', v_detail->>'outcome', 'priority', v_detail->>'priority',
      'healthcare_aligned', (v_detail->>'healthcare_aligned')::boolean),
    jsonb_build_object('outcome', 'does_not_meet', 'priority', 'south_yorkshire', 'healthcare_aligned', true),
    'the audit row carries the outcome plus the priority/healthcare-alignment signals'
  );

  -- Re-running the same outcome with unchanged reasons is a no-op: it must not
  -- reset an admin's prior resolution of that exact issue, and must not audit
  -- a second time.
  update public.data_quality_events set resolved = true, resolved_at = now(), resolved_by_user_id = v_admin
   where raw_source_record_id = v_review and rule_name = 'client_criteria_needs_review';
  select count(*) into v_events_before from public.audit_log where action = 'client_criteria_rejected';
  perform public.record_client_criteria_outcome(
    v_review, 'needs_review', 'company', 'Needs social-purpose evidence.', 'standard', false);
  select resolved into v_resolved from public.data_quality_events
   where raw_source_record_id = v_review and rule_name = 'client_criteria_needs_review';
  return next is(v_resolved, true, 're-recording an unchanged outcome does not un-resolve an admin''s review');
  return next is(
    (select count(*) from public.audit_log where action = 'client_criteria_rejected'),
    v_events_before, 'an unchanged no-op re-evaluation is not audited a second time');

  -- Flipping outcome (needs_review -> does_not_meet) on re-evaluation must not
  -- leave the old outcome's row dangling open forever.
  perform public.record_client_criteria_outcome(
    v_flip, 'needs_review', 'company', 'Needs social-purpose evidence.', 'standard', false);
  perform public.record_client_criteria_outcome(
    v_flip, 'does_not_meet', 'commercial', 'Confirmed outside criteria.', 'standard', false);
  return next is(
    (select resolved from public.data_quality_events
      where raw_source_record_id = v_flip and rule_name = 'client_criteria_needs_review'),
    true, 'the superseded outcome from before a re-evaluation flip is closed out, not left dangling');
  return next is(
    (select resolved from public.data_quality_events
      where raw_source_record_id = v_flip and rule_name = 'client_criteria_does_not_meet'),
    false, 'the current outcome after a flip is still open for review');

  perform tests.login_as(v_cam);
  select count(*) into v_count from public.data_quality_events where raw_source_record_id in (v_review, v_fail);
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'CAM cannot read the admin quality-review queue');

  perform tests.login_as(v_admin);
  select count(*) into v_count from public.data_quality_events where raw_source_record_id in (v_review, v_fail);
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 2::bigint, 'admin can find both distinct criteria outcomes');
end;
$$;

-- ---------------------------------------------------------------------------
-- manual client entry (F036)
-- ---------------------------------------------------------------------------

create or replace function tests.suite_manual_entries()
returns setof text language plpgsql as $$
declare
  v_admin  uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a  uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b  uuid := '00000000-0000-4000-a000-000000000003';
  v_viewer uuid := '00000000-0000-4000-a000-000000000005';
  v_entry uuid;
  v_approval_entry uuid;
  v_duplicate_entry uuid;
  v_company_entry uuid;
  v_admin_entry uuid;
  v_admin_org uuid;
  v_created_org uuid;
  v_linked_org uuid;
  v_count bigint;
begin
  if not tests.tables_exist('manual_entry_records', 'users', 'audit_log') then
    return next skip(21, 'F036 manual entry migration not yet applied');
    return;
  end if;
  perform tests.seed();

  return next is(
    tests.sqlstate_of(v_viewer, $query$
      select public.save_manual_entry(
        null, 'No', null, null, null, null, null, null,
        null, null, null, null, null, false
      )
    $query$),
    '42501', 'viewer cannot save a manual-entry draft');

  perform tests.login_as(v_cam_a);
  select public.save_manual_entry(
    null, 'Draft Charity', null, null, null, null, null, 'GB',
    null, null, null, null, null, false
  ) into v_entry;
  select count(*) into v_count from public.manual_entry_records where id = v_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 1::bigint, 'CAM can save and read their own incomplete draft');

  perform tests.login_as(v_cam_a);
  perform public.save_manual_entry(
    v_entry, 'Draft Charity Renamed', null, null, null, null, null, 'GB',
    null, null, null, null, null, false
  );
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  select count(*) into v_count from public.manual_entry_records
   where id = v_entry and legal_name = 'Draft Charity Renamed' and review_status = 'draft';
  return next is(v_count, 1::bigint, 'the creating CAM can resume and update their draft');

  perform tests.login_as(v_cam_b);
  select count(*) into v_count from public.manual_entry_records where id = v_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'another CAM cannot read the submission');

  perform tests.login_as(v_admin);
  select count(*) into v_count from public.manual_entry_records where id = v_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 1::bigint, 'admin can review every manual entry');

  return next is(
    tests.sqlstate_of(v_cam_a, format($query$
      select public.save_manual_entry(
        %L, 'Incomplete', null, null, null, null, null, 'GB',
        null, null, null, null, null, true
      )
    $query$, v_entry)),
    '22023', 'an incomplete draft cannot be submitted');

  perform tests.login_as(v_cam_a);
  perform public.save_manual_entry(
    v_entry, 'Manual Charity', 'Improves health outcomes in South Yorkshire.', 'charity',
    '1 Example Street', 'Sheffield', 'S1 2AB', 'GB',
    'https://manual.example.org', 'bad-email', 'Charity Commission', 'F036-REJECT',
    'Not available from an API source', true
  );
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  select count(*) into v_count from public.manual_entry_records
   where id = v_entry and review_status = 'pending';
  return next is(v_count, 1::bigint, 'a complete CAM draft can be submitted for admin review');

  return next is(
    tests.sqlstate_of(v_cam_a, format('update public.manual_entry_records set review_status = ''approved'' where id = %L', v_entry)),
    '42501', 'CAM cannot approve their own submission directly');

  perform tests.login_as(v_admin);
  perform public.reject_manual_entry(v_entry, 'Does not meet the agreed criteria');
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  select count(*) into v_count from public.audit_log where target_id = v_entry and action = 'manual_entry_rejected';
  return next is(v_count, 1::bigint, 'admin rejection and its audit record are written together');

  perform tests.login_as(v_cam_a);
  select public.save_manual_entry(
    null, 'Unique F036 Charity', 'Provides international community services.', 'charity',
    '10 Rue Exemple', 'Paris', '75001', 'FR', 'https://example.org', 'hello@example.org',
    'International Registry', 'F036-001', 'Not available from an API source', true
  ) into v_approval_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.approve_manual_entry(%L, false, ''create_new'', null, null)',
      v_approval_entry
    )),
    '42501', 'CAM cannot call the manual approval RPC');

  perform tests.login_as(v_admin);
  select public.approve_manual_entry(
    v_approval_entry, false, 'create_new', null, 'Meets the target criteria'
  ) into v_created_org;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next ok(v_created_org is not null, 'admin can approve a distinct manual entry');

  select count(*) into v_count
    from public.organisations
   where id = v_created_org and entry_method = 'manual' and country_code = 'FR'
     and organisation_type = 'charity' and address_line_1 = '10 Rue Exemple'
     and city = 'Paris' and postcode = '75001';
  return next is(v_count, 1::bigint, 'approval creates the standard active manual organisation');

  select count(*) into v_count
    from public.enrichment_results
   where organisation_id = v_created_org
     and mission_statement = 'Provides international community services.';
  return next is(v_count, 1::bigint, 'approval copies the required mission into the active profile');

  select count(*) into v_count
    from public.audit_log
   where target_id = v_created_org and action = 'manual_entry_approved';
  return next is(v_count, 1::bigint, 'manual approval and its audit record are written together');

  perform tests.login_as(v_cam_b);
  select count(*) into v_count
    from public.get_organisation_sources_with_actor(v_created_org)
   where source = 'manual' and source_actor_user_id = v_cam_a;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 1::bigint, 'manual source identifies the creating CAM to active users');

  perform tests.login_as(v_cam_b);
  select public.save_manual_entry(
    null, 'Unique F036 Charity Limited', 'Provides related community services.', 'charity',
    '20 Example Road', 'Sheffield', 'S2 3CD', 'GB', 'https://duplicate.example.org',
    'info@duplicate.example.org', 'Charity Commission', 'F036-002',
    'Submitted independently for duplicate review', true
  ) into v_duplicate_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.approve_manual_entry(%L, false, ''create_new'', %L, null)',
      v_duplicate_entry, v_created_org
    )),
    '22023', 'a likely duplicate cannot become a second client without a human explanation');

  perform tests.login_as(v_admin);
  select public.approve_manual_entry(
    v_duplicate_entry, false, 'link_existing', v_created_org,
    'Same organisation despite the formatting difference'
  ) into v_linked_org;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_linked_org, v_created_org, 'confirmed duplicate links to the existing active client');

  perform tests.login_as(v_cam_a);
  select public.save_manual_entry(
    null, 'Unconfirmed Social Company', 'Develops socially focused services.', 'company',
    '30 Example Lane', 'Sheffield', 'S3 4EF', 'GB', 'https://social.example.org',
    'info@social.example.org', 'Companies House', 'F036-COMPANY',
    'May be a socially focused organisation', true
  ) into v_company_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.approve_manual_entry(%L, true, null, null, null)',
      v_company_entry
    )),
    '22023', 'a null duplicate decision cannot bypass the approval decision');

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.approve_manual_entry(%L, null, ''create_new'', null, null)',
      v_company_entry
    )),
    '22023', 'a null eligibility confirmation cannot bypass F047');

  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.approve_manual_entry(%L, false, ''create_new'', null, null)',
      v_company_entry
    )),
    '22023', 'ambiguous company cannot bypass the F047 human eligibility decision');

  perform tests.login_as(v_admin);
  select public.save_manual_entry(
    null, 'Admin Entered Charity', 'Supports people through direct services.', 'charity',
    '40 Admin Street', 'Sheffield', 'S4 5GH', 'GB', 'https://admin.example.org',
    'admin@example.org', 'Charity Commission', 'F036-ADMIN',
    'Added directly by an administrator', true
  ) into v_admin_entry;
  select public.approve_manual_entry(
    v_admin_entry, false, 'create_new', null, 'Submitted and self-approved by admin'
  ) into v_admin_org;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  select count(*) into v_count from public.manual_entry_records
   where id = v_admin_entry and review_status = 'approved'
     and reviewed_by_user_id = v_admin and converted_to_organisation_id = v_admin_org;
  return next is(v_count, 1::bigint, 'an admin can activate their own submission without another admin');
end;
$$;

-- ---------------------------------------------------------------------------
-- F037 Manual URL Import: provenance columns and their RPCs.
--
-- The import writes through create_url_import_draft, so the questions here are the
-- ones the flow depends on being true: an import can only ever produce a draft, only
-- its own submitter can touch it, the provenance list can be narrowed but never
-- widened, and every one of those writes leaves an audit row.
-- ---------------------------------------------------------------------------
create or replace function tests.suite_url_import()
returns setof text language plpgsql as $$
declare
  v_cam_a  uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b  uuid := '00000000-0000-4000-a000-000000000003';
  v_viewer uuid := '00000000-0000-4000-a000-000000000005';
  v_entry uuid;
  v_typed_entry uuid;
  v_submitted_entry uuid;
  v_paths jsonb;
  v_count bigint;
begin
  if not tests.columns_exist('manual_entry_records', 'source_url', 'imported_field_paths') then
    return next skip(18, 'F037 URL import migration not yet applied');
    return;
  end if;
  perform tests.seed();

  return next is(
    tests.sqlstate_of(v_viewer, $query$
      select public.create_url_import_draft(
        'https://example.org/', null, '["legal_name"]'::jsonb, '[]'::jsonb,
        'Example Trust', null, null, null, null, null, 'GB', null, null, null, null
      )
    $query$),
    '42501', 'a viewer cannot create a draft from a URL import');

  perform tests.login_as(v_cam_a);
  select public.create_url_import_draft(
    'https://example.org/about',
    null,
    '["legal_name", "postcode", "country_code"]'::jsonb,
    '["The company number on this website could not be confirmed."]'::jsonb,
    'Example Trust', 'We do good things.', 'charity', '1 High Street', 'Sheffield',
    'S1 1AA', 'GB', 'https://example.org', 'info@example.org',
    'Charity Commission for England and Wales', '1101126'
  ) into v_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  select count(*) into v_count from public.manual_entry_records
   where id = v_entry and review_status = 'draft';
  return next is(v_count, 1::bigint, 'an import produces a draft, never a submission');

  select count(*) into v_count from public.manual_entry_records
   where id = v_entry and source_url = 'https://example.org/about';
  return next is(v_count, 1::bigint, 'the source URL is retained with the imported record');

  select imported_field_paths into v_paths from public.manual_entry_records where id = v_entry;
  return next is(
    v_paths, '["legal_name", "postcode", "country_code"]'::jsonb,
    'the imported fields are recorded so the CAM can tell them apart');

  select count(*) into v_count from public.manual_entry_records
   where id = v_entry and jsonb_array_length(import_notes) = 1;
  return next is(v_count, 1::bigint, 'what the import could not confirm is kept with the draft');

  select count(*) into v_count from public.audit_log
   where target_id = v_entry and action = 'url_import_drafted';
  return next is(v_count, 1::bigint, 'creating a draft from a URL is audited');

  return next is(
    tests.sqlstate_of(v_cam_a, $query$
      select public.create_url_import_draft(
        '  ', null, '[]'::jsonb, '[]'::jsonb,
        'No Origin', null, null, null, null, null, 'GB', null, null, null, null
      )
    $query$),
    '22023', 'an imported draft cannot be created without the URL it came from');

  perform tests.login_as(v_cam_b);
  select count(*) into v_count from public.manual_entry_records where id = v_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'another CAM cannot read the importing CAM''s draft');

  -- The CAM corrected the name, so it is no longer the website's value.
  perform tests.login_as(v_cam_a);
  perform public.set_url_import_provenance(v_entry, '["postcode", "country_code"]'::jsonb);
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  select imported_field_paths into v_paths from public.manual_entry_records where id = v_entry;
  return next is(
    v_paths, '["postcode", "country_code"]'::jsonb,
    'a field the CAM edits stops being labelled as imported');

  -- A forged list must not be able to blame the website for the CAM's own typing.
  perform tests.login_as(v_cam_a);
  perform public.set_url_import_provenance(
    v_entry, '["postcode", "country_code", "mission_statement", "contact_email"]'::jsonb);
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  select imported_field_paths into v_paths from public.manual_entry_records where id = v_entry;
  return next is(
    v_paths, '["postcode", "country_code"]'::jsonb,
    'provenance can only ever be narrowed, never extended');

  return next is(
    tests.sqlstate_of(v_cam_b, format(
      'select public.set_url_import_provenance(%L, ''[]''::jsonb)', v_entry)),
    '42501', 'another CAM cannot rewrite the provenance of a draft that is not theirs');

  perform tests.login_as(v_cam_a);
  select public.save_manual_entry(
    null, 'Typed By Hand', null, null, null, null, null, 'GB',
    null, null, null, null, null, false
  ) into v_typed_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_url_import_provenance(%L, ''["legal_name"]''::jsonb)', v_typed_entry)),
    '22023', 'a hand-typed entry cannot be given import provenance');

  return next throws_ok(
    format(
      'insert into public.manual_entry_records (submitted_by_user_id, legal_name, imported_field_paths) '
      || 'values (%L, ''Orphan'', ''["legal_name"]''::jsonb)', v_cam_a),
    '23514',
    null,
    'fields cannot be marked as imported without a URL to attribute them to'
  );

  return next is(
    tests.sqlstate_of(v_cam_b, format('select public.discard_manual_entry_draft(%L)', v_entry)),
    '42501', 'another CAM cannot discard a draft that is not theirs');

  perform tests.login_as(v_cam_a);
  perform public.discard_manual_entry_draft(v_entry);
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  select count(*) into v_count from public.manual_entry_records where id = v_entry;
  return next is(v_count, 0::bigint, 'the importing CAM can reject and discard the import');

  select count(*) into v_count from public.audit_log
   where target_id = v_entry and action = 'manual_entry_draft_discarded';
  return next is(v_count, 1::bigint, 'discarding an import is audited before the row goes');

  perform tests.login_as(v_cam_a);
  select public.save_manual_entry(
    null, 'Submitted Entry', 'A mission.', 'charity', '1 High Street', 'Sheffield',
    'S1 1AA', 'GB', 'https://example.org', 'info@example.org',
    'Charity Commission for England and Wales', '1101126', 'Not found through any API.', true
  ) into v_submitted_entry;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.discard_manual_entry_draft(%L)', v_submitted_entry)),
    '42501', 'a submitted entry is part of the audit trail and cannot be discarded');

  perform tests.login_as(v_cam_b);
  select count(*) into v_count from public.get_organisation_import_origin(
    '00000000-0000-4000-b000-000000000001'::uuid);
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(
    v_count, 0::bigint,
    'an organisation nobody imported reports no import origin');
end;
$$;

-- ---------------------------------------------------------------------------
-- F246: data handling rules — RLS, the two write RPCs, and the audit trail
-- ---------------------------------------------------------------------------
-- These rules decide what personal data the platform is allowed to store, so the
-- interesting claims are all about who may change them. The node tests in
-- src/lib/ingestion cover the filtering itself, but they run through a
-- service_role client, which bypasses RLS — they cannot prove any of this.

create or replace function tests.suite_data_handling_rules()
returns setof text language plpgsql as $$
declare
  v_admin        uuid := '00000000-0000-4000-a000-000000000001';
  v_cam          uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer       uuid := '00000000-0000-4000-a000-000000000005';
  v_dead_admin   uuid := '00000000-0000-4000-a000-000000000006';
  v_backdated    timestamptz := timestamptz '2000-01-01';
  v_rule_id      uuid;
  v_count        bigint;
  v_version_before integer;
  v_version_after  integer;
  v_audit_before bigint;
begin
  if not tests.tables_exist('data_handling_rules', 'data_handling_rule_versions', 'audit_log') then
    return next skip(1, 'step 22.7 create_data_handling_rules not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- A deactivated *admin*, which the shared fixture does not have. Without one,
  -- the is_active_user() branch of both RPCs is never exercised: the deactivated
  -- CAM fails the is_admin() check first and the test would pass for the wrong
  -- reason.
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_dead_admin, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'ex-admin@180dc.org')
  on conflict (id) do nothing;
  insert into public.users (id, email, full_name, role, is_active, created_at, updated_at)
  values (v_dead_admin, 'ex-admin@180dc.org', 'Deactivated Admin', 'admin', false, v_backdated, v_backdated)
  on conflict (id) do update
    set role = excluded.role, is_active = excluded.is_active;

  -- -- Reads -----------------------------------------------------------------
  -- The rules name the fields the platform refuses to hold. That list is an
  -- admin concern; a CAM has no reason to see it and no way to act on it.

  perform tests.login_as(v_cam);
  select count(*) into v_count from public.data_handling_rules;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'CAM cannot read the data handling rules');

  perform tests.login_as(v_viewer);
  select count(*) into v_count from public.data_handling_rules;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'viewer cannot read the data handling rules');

  perform tests.login_as(v_admin);
  select count(*) into v_count from public.data_handling_rules;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next ok(v_count > 0, 'admin can read the data handling rules');

  perform tests.login_as(v_cam);
  select count(*) into v_count from public.data_handling_rule_versions;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'CAM cannot read the rule version singleton');

  -- -- Direct writes are closed off entirely -----------------------------------
  -- There is no INSERT/UPDATE/DELETE policy for authenticated on either table, so
  -- even an admin has to go through the RPCs. That is what keeps the audit write
  -- and the version bump from being optional.

  return next ok(
    not has_table_privilege('authenticated', 'public.data_handling_rules', 'INSERT'),
    'authenticated holds no INSERT privilege on data_handling_rules'
  );
  return next ok(
    not has_table_privilege('authenticated', 'public.data_handling_rules', 'DELETE'),
    'authenticated holds no DELETE privilege on data_handling_rules'
  );
  return next ok(
    not has_table_privilege('authenticated', 'public.data_handling_rule_versions', 'UPDATE'),
    'authenticated cannot bump the rule version directly'
  );

  return next isnt(
    tests.sqlstate_of(v_admin,
      'insert into public.data_handling_rules (rule_version, field_path, action, reason) ' ||
      'values (99, ''smuggled'', ''deny'', ''bypassing the RPC'')'),
    null,
    'even an admin cannot insert a rule directly, bypassing the audit trail'
  );

  -- -- create_data_handling_rule ----------------------------------------------

  return next is(
    tests.sqlstate_of(v_cam,
      'select public.create_data_handling_rule(''companies_house'', ''sneaky[*].path'', ''deny'', ''CAM attempt'')'),
    'P0001',
    'CAM cannot create a data handling rule'
  );

  return next is(
    tests.sqlstate_of(v_dead_admin,
      'select public.create_data_handling_rule(''companies_house'', ''sneaky[*].path'', ''deny'', ''deactivated attempt'')'),
    'P0001',
    'a deactivated admin cannot create a data handling rule'
  );

  -- State, not just SQLSTATE: a raise that happened after the insert would still
  -- report P0001 while leaving the row behind.
  select count(*) into v_count
    from public.data_handling_rules where field_path = 'sneaky[*].path';
  return next is(v_count, 0::bigint,
    'no rule survives the blocked create attempts');

  -- A reason is mandatory — the rules are a compliance record, and one without a
  -- stated justification is not reviewable by anyone later.
  return next is(
    tests.sqlstate_of(v_admin,
      'select public.create_data_handling_rule(''companies_house'', ''some[*].path'', ''deny'', '''')'),
    'P0001',
    'a rule cannot be created without a reason'
  );

  select current_version into v_version_before from public.data_handling_rule_versions where id = true;
  select count(*) into v_audit_before from public.audit_log where action = 'data_handling_rule_created';

  perform tests.login_as(v_admin);
  select public.create_data_handling_rule(
    'companies_house', 'pgtap[*].secret', 'deny', 'pgTAP fixture rule'
  ) into v_rule_id;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  return next ok(v_rule_id is not null, 'admin can create a data handling rule');

  select current_version into v_version_after from public.data_handling_rule_versions where id = true;
  return next is(v_version_after, v_version_before + 1,
    'creating a rule bumps the global rule version');

  -- The version stamped on the rule is the one ingestion will report against the
  -- records it filters, so it has to be the post-bump number.
  return next is(
    (select rule_version from public.data_handling_rules where id = v_rule_id),
    v_version_after,
    'the new rule carries the version it was created at');

  return next is(
    (select created_by from public.data_handling_rules where id = v_rule_id),
    v_admin,
    'the rule records the admin who created it');

  return next is(
    (select count(*) from public.audit_log
      where action = 'data_handling_rule_created' and target_id = v_rule_id),
    1::bigint,
    'creating a rule writes exactly one audit_log entry');

  return next is(
    (select actor_user_id from public.audit_log
      where action = 'data_handling_rule_created' and target_id = v_rule_id),
    v_admin,
    'the audit entry names the acting admin');

  -- The detail payload is what a reviewer actually reads months later.
  return next is(
    (select detail->>'field_path' from public.audit_log
      where action = 'data_handling_rule_created' and target_id = v_rule_id),
    'pgtap[*].secret',
    'the audit entry records which field the rule governs');
  return next is(
    (select detail->>'reason' from public.audit_log
      where action = 'data_handling_rule_created' and target_id = v_rule_id),
    'pgTAP fixture rule',
    'the audit entry records the stated reason');

  -- One active rule per (source, field_path). Without this an admin could stack
  -- a deny and an allow on the same field and the outcome would depend on row order.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.create_data_handling_rule(''companies_house'', ''pgtap[*].secret'', ''allow'', ''duplicate'')')),
    '23505',
    'a second active rule for the same source and field_path is rejected'
  );

  -- -- set_data_handling_rule_active -------------------------------------------

  return next is(
    tests.sqlstate_of(v_cam, format(
      'select public.set_data_handling_rule_active(%L, false, ''CAM attempt'')', v_rule_id)),
    'P0001',
    'CAM cannot deactivate a data handling rule'
  );

  return next is(
    (select is_active from public.data_handling_rules where id = v_rule_id),
    true,
    'the rule is genuinely still active after the blocked attempt');

  select current_version into v_version_before from public.data_handling_rule_versions where id = true;

  perform tests.login_as(v_admin);
  perform public.set_data_handling_rule_active(v_rule_id, false, 'no longer required');
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  return next is(
    (select is_active from public.data_handling_rules where id = v_rule_id),
    false,
    'admin can deactivate a rule');

  select current_version into v_version_after from public.data_handling_rule_versions where id = true;
  return next is(v_version_after, v_version_before + 1,
    'deactivating a rule bumps the global rule version');

  return next is(
    (select count(*) from public.audit_log
      where action = 'data_handling_rule_deactivated' and target_id = v_rule_id),
    1::bigint,
    'deactivating a rule writes an audit_log entry');

  return next is(
    (select detail->>'reason' from public.audit_log
      where action = 'data_handling_rule_deactivated' and target_id = v_rule_id),
    'no longer required',
    'the deactivation audit entry records the reason given');

  -- A no-op must stay a no-op. Bumping the version on an unchanged toggle would
  -- invalidate every record stamped with the old one and trigger a pointless
  -- re-ingestion of the entire table.
  select current_version into v_version_before from public.data_handling_rule_versions where id = true;

  perform tests.login_as(v_admin);
  perform public.set_data_handling_rule_active(v_rule_id, false, 'again');
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  select current_version into v_version_after from public.data_handling_rule_versions where id = true;
  return next is(v_version_after, v_version_before,
    'toggling a rule to the state it already holds does not bump the version');

  return next is(
    (select count(*) from public.audit_log
      where action = 'data_handling_rule_deactivated' and target_id = v_rule_id),
    1::bigint,
    'a no-op toggle writes no second audit entry');

  -- Deactivating frees the (source, field_path) slot, so the policy can be
  -- restated with a different action without deleting the history of the old one.
  perform tests.login_as(v_admin);
  select public.create_data_handling_rule(
    'companies_house', 'pgtap[*].secret', 'allow', 'restated after review'
  ) into v_rule_id;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  return next ok(v_rule_id is not null,
    'the same field_path can be ruled on again once the old rule is inactive');

  -- -- Read RPCs ---------------------------------------------------------------
  -- These aggregate over raw_source_records, so they are SECURITY DEFINER and
  -- carry their own admin check — without it they would be a way for any signed-in
  -- user to read which fields the platform strips and how often.

  return next is(
    tests.sqlstate_of(v_cam, 'select * from public.data_handling_filter_summary()'),
    'P0001',
    'CAM cannot read the filter summary'
  );
  return next is(
    tests.sqlstate_of(v_viewer, 'select * from public.data_handling_coverage()'),
    'P0001',
    'viewer cannot read data handling coverage'
  );
  return next is(
    tests.sqlstate_of(v_dead_admin, 'select * from public.data_handling_coverage()'),
    'P0001',
    'a deactivated admin cannot read data handling coverage'
  );
  return next is(
    tests.sqlstate_of(v_admin, 'select * from public.data_handling_coverage()'),
    null,
    'admin can read data handling coverage'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- F247: personal data exclusion — role email allow-list and app.is_personal_email
-- ---------------------------------------------------------------------------
-- rule_kind and the two redact_* kinds live on data_handling_rules itself, so
-- they're covered by suite_data_handling_rules() above via the same RPC. What's
-- new here is the second table F247 adds — PERSONAL_EMAIL_ROLE_PARTS — and the
-- SQL half of the email detector, app.is_personal_email, which the node tests in
-- personal-data.test.ts cannot reach: they run through a service_role client,
-- which bypasses RLS.

create or replace function tests.suite_personal_data_exclusion()
returns setof text language plpgsql as $$
declare
  v_admin      uuid := '00000000-0000-4000-a000-000000000001';
  v_cam        uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer     uuid := '00000000-0000-4000-a000-000000000005';
  v_dead_admin uuid := '00000000-0000-4000-a000-000000000006';
  v_backdated  timestamptz := timestamptz '2000-01-01';
  v_count      bigint;
begin
  if not tests.tables_exist('personal_email_role_parts', 'data_handling_rules') then
    return next skip(1, 'F247 add_personal_data_exclusion not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Same deactivated-admin fixture suite_data_handling_rules() creates. Written
  -- the same idempotent way so either suite can run alone.
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_dead_admin, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'ex-admin@180dc.org')
  on conflict (id) do nothing;
  insert into public.users (id, email, full_name, role, is_active, created_at, updated_at)
  values (v_dead_admin, 'ex-admin@180dc.org', 'Deactivated Admin', 'admin', false, v_backdated, v_backdated)
  on conflict (id) do update
    set role = excluded.role, is_active = excluded.is_active;

  -- -- Reads -----------------------------------------------------------------
  -- The role list decides whose address the ingestion runner keeps, so it
  -- carries the same read shape as data_handling_rules: admin only.

  perform tests.login_as(v_cam);
  select count(*) into v_count from public.personal_email_role_parts;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'CAM cannot read personal_email_role_parts');

  perform tests.login_as(v_viewer);
  select count(*) into v_count from public.personal_email_role_parts;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'viewer cannot read personal_email_role_parts');

  perform tests.login_as(v_admin);
  select count(*) into v_count from public.personal_email_role_parts;
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);
  return next ok(v_count > 0, 'admin can read personal_email_role_parts');

  -- -- Direct writes are closed off -------------------------------------------
  -- No INSERT/UPDATE policy for authenticated; every write goes through
  -- set_personal_email_role_part below, so the audit entry is never optional.

  return next ok(
    not has_table_privilege('authenticated', 'public.personal_email_role_parts', 'INSERT'),
    'authenticated holds no INSERT privilege on personal_email_role_parts'
  );
  return next ok(
    not has_table_privilege('authenticated', 'public.personal_email_role_parts', 'UPDATE'),
    'authenticated holds no UPDATE privilege on personal_email_role_parts'
  );

  -- -- Both RPCs refuse a CAM and a deactivated admin ---------------------------

  return next is(
    tests.sqlstate_of(v_cam,
      'select public.create_data_handling_rule(null, ''*'', ''deny'', ''CAM attempt'', ''redact_personal_email'')'),
    'P0001',
    'CAM cannot create a redaction rule'
  );
  return next is(
    tests.sqlstate_of(v_dead_admin,
      'select public.create_data_handling_rule(null, ''*'', ''deny'', ''deactivated attempt'', ''redact_personal_email'')'),
    'P0001',
    'a deactivated admin cannot create a redaction rule'
  );

  return next is(
    tests.sqlstate_of(v_cam,
      'select public.set_personal_email_role_part(''pgtap-role'', true, ''CAM attempt'')'),
    'P0001',
    'CAM cannot change the role email list'
  );
  return next is(
    tests.sqlstate_of(v_dead_admin,
      'select public.set_personal_email_role_part(''pgtap-role'', true, ''deactivated attempt'')'),
    'P0001',
    'a deactivated admin cannot change the role email list'
  );

  select count(*) into v_count
    from public.personal_email_role_parts where local_part = 'pgtap-role';
  return next is(v_count, 0::bigint,
    'no role part survives the blocked set attempts');

  -- Admin path: add, audit, no-op safety.
  perform tests.login_as(v_admin);
  perform public.set_personal_email_role_part('pgtap-role', true, 'pgTAP fixture role');
  execute 'reset role'; perform set_config('request.jwt.claims', null, true);

  return next is(
    (select is_active from public.personal_email_role_parts where local_part = 'pgtap-role'),
    true,
    'admin can add a role email local part');

  return next is(
    (select count(*) from public.audit_log
      where action = 'personal_email_role_part_added' and detail->>'local_part' = 'pgtap-role'),
    1::bigint,
    'adding a role part writes an audit_log entry');

  -- -- app.is_personal_email: role vs personal pairs ---------------------------
  -- Same word-splitting rule personal-data.test.ts asserts in TypeScript; this
  -- proves the SQL half agrees, run as admin so the read against
  -- personal_email_role_parts the function depends on is not itself the thing
  -- under test.

  perform tests.login_as(v_admin);

  return next ok(
    not app.is_personal_email('info@example.org'),
    'a bare role local part is not personal'
  );
  return next ok(
    not app.is_personal_email('fundraising.team@example.org'),
    'a role local part wearing a suffix is not personal'
  );
  return next ok(
    not app.is_personal_email('no-reply@example.org'),
    '''no-reply'' splits into ''no'' and ''reply'', and ''reply'' is a role part'
  );
  return next ok(
    app.is_personal_email('joanne.smith@example.org'),
    'a two-word personal name is personal'
  );
  return next ok(
    app.is_personal_email('jsmith@example.org'),
    'an unlisted local part is treated as personal, not role — the allow-list direction'
  );
  return next ok(
    not app.is_personal_email('not-an-address'),
    'a string with no @ is not something this function has an opinion about'
  );

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- -- manual_entry_records trigger: personal email rejected (AC3) -------------
  if tests.tables_exist('manual_entry_records') then
    return next is(
      tests.sqlstate_of(v_cam,
        'select public.save_manual_entry(null, ''Personal Email Test'', null, null, null, null, null, ''GB'', null, ''joanne.smith@example.org'', null, null, null, false)'),
      '22023',
      'saving a manual entry with a personal email is rejected by trigger'
    );

    return next is(
      tests.sqlstate_of(v_cam,
        'select public.save_manual_entry(null, ''Role Email Test'', null, null, null, null, null, ''GB'', null, ''info@example.org'', null, null, null, false)'),
      null,
      'saving a manual entry with a role email is accepted'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- ownership_requests (#408, F165 follow-up)
-- ---------------------------------------------------------------------------
-- Matrix §3.17. The point of this suite is the negative: a CAM has no path to a
-- client another CAM owns except asking, and asking moves nothing on its own.

create or replace function tests.suite_ownership_requests()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b       uuid := '00000000-0000-4000-a000-000000000003';
  v_viewer      uuid := '00000000-0000-4000-a000-000000000005';
  v_org_unowned uuid := '00000000-0000-4000-b000-000000000001';
  v_org_cam_b   uuid := '00000000-0000-4000-b000-000000000003';
  v_req_id      uuid;
  v_status      public.ownership_request_status;
  v_owner       uuid;
  v_count       bigint;
begin
  if not tests.tables_exist('organisations', 'users', 'audit_log', 'ownership_requests')
     or to_regprocedure('public.request_client_ownership(uuid, text)') is null
     or to_regprocedure('public.decide_ownership_request(uuid, boolean, text)') is null then
    return next skip(18, 'ownership_requests table or RPCs not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- Every write is RPC-only (recipe step 4), same shape as suppressions.
  return next ok(
    not has_table_privilege('authenticated', 'public.ownership_requests', 'INSERT'),
    'authenticated holds no direct INSERT privilege on ownership_requests'
  );
  return next ok(
    not has_table_privilege('authenticated', 'public.ownership_requests', 'UPDATE'),
    'authenticated holds no direct UPDATE privilege on ownership_requests'
  );

  -- A viewer has no ownership to request.
  return next is(
    tests.sqlstate_of(v_viewer, format(
      'select public.request_client_ownership(%L, ''viewer wants a client'')', v_org_cam_b)),
    '42501',
    'viewer cannot call request_client_ownership'
  );

  -- An admin reassigns directly rather than requesting from themselves.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.request_client_ownership(%L, ''admin asking'')', v_org_cam_b)),
    '42501',
    'an admin is refused: they hold reassign_ownership already'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.request_client_ownership(%L, ''   '')', v_org_cam_b)),
    '23514',
    'blank reason is rejected'
  );

  -- An unowned client is claimed, not requested.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.request_client_ownership(%L, ''nobody owns it'')', v_org_unowned)),
    '55000',
    'requesting an unowned client is refused — claim it instead'
  );

  -- CAM A asks for CAM B's client. This is the whole sanctioned path.
  perform tests.login_as(v_cam_a);
  select public.request_client_ownership(v_org_cam_b, 'I already run their sister charity')
    into v_req_id;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select status into v_status from public.ownership_requests where id = v_req_id;
  return next is(v_status, 'pending'::public.ownership_request_status,
    'a CAM''s request lands pending');

  -- The request moved nothing. This is the acceptance criterion that matters.
  select owner_id into v_owner from public.organisations where id = v_org_cam_b;
  return next is(v_owner, v_cam_b, 'the client has not moved: a request is not a handover');

  select count(*) into v_count from public.audit_log
   where action = 'ownership_requested' and target_id = v_org_cam_b;
  return next is(v_count, 1::bigint, 'the request writes one ownership_requested audit row');

  -- Still no direct route, request or no request.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.claim_organisation(%L)', v_org_cam_b)),
    '55000',
    'a pending request does not unlock claim_organisation on an owned client'
  );
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'update public.organisations set owner_id = %L where id = %L', v_cam_a, v_org_cam_b)),
    '42501',
    'a CAM cannot write owner_id directly, request or no request'
  );

  -- The requester cannot approve their own ask.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.decide_ownership_request(%L, true, null)', v_req_id)),
    '42501',
    'the requesting CAM cannot decide their own request'
  );

  -- Nor can a second identical ask be queued.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.request_client_ownership(%L, ''asking again'')', v_org_cam_b)),
    '23505',
    'a second pending request from the same CAM for the same client is rejected'
  );

  -- Admin approves: this is what moves the client, through reassign_ownership.
  perform tests.login_as(v_admin);
  perform public.decide_ownership_request(v_req_id, true, 'agreed on the Wednesday call');
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select status into v_status from public.ownership_requests where id = v_req_id;
  return next is(v_status, 'approved'::public.ownership_request_status,
    'admin approval marks the request approved');

  select owner_id into v_owner from public.organisations where id = v_org_cam_b;
  return next is(v_owner, v_cam_a, 'approval moves the client to the requesting CAM');

  select count(*) into v_count from public.audit_log
   where action = 'ownership_reassigned' and target_id = v_org_cam_b;
  return next is(v_count, 1::bigint,
    'the handover is audited as a normal ownership_assigned transition');

  select count(*) into v_count from public.audit_log
   where action = 'ownership_request_approved' and target_id = v_org_cam_b;
  return next is(v_count, 1::bigint, 'the decision itself is audited too');

  -- Deciding twice is refused, not silently re-applied.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'select public.decide_ownership_request(%L, false, null)', v_req_id)),
    '55000',
    'deciding a request that is no longer pending is rejected'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- outreach preferences (F195 / F187)
-- ---------------------------------------------------------------------------

create or replace function tests.suite_outreach_preferences()
returns setof text language plpgsql as $$
declare
  v_cam_a  uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b  uuid := '00000000-0000-4000-a000-000000000003';
  v_admin  uuid := '00000000-0000-4000-a000-000000000001';
  v_viewer uuid := '00000000-0000-4000-a000-000000000004';
  v_count  bigint;
begin
  if not tests.tables_exist('outreach_preferences') then
    return next skip(6, 'F195 outreach preferences table not yet migrated');
    return;
  end if;

  perform tests.seed();

  -- CAM A writes their own preferences
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.outreach_preferences (user_id, preferred_geographic_reach, preferred_sectors, preferred_income_bands) values (%L, %L, %L, %L) on conflict (user_id) do nothing',
      v_cam_a, '{local,regional}'::public.geographic_reach[], '{"Education","Health"}'::text[], '{under_10k,10k_100k}'::public.income_band[])),
    null,
    'a CAM can save their own outreach preferences (F195)'
  );

  -- CAM A reads their own preferences
  perform tests.login_as(v_cam_a);
  select count(*) into v_count from public.outreach_preferences where user_id = v_cam_a;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 1::bigint, 'a CAM can view their own outreach preferences (F195)');

  -- CAM B cannot read CAM A's preferences
  perform tests.login_as(v_cam_b);
  select count(*) into v_count from public.outreach_preferences where user_id = v_cam_a;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'a CAM cannot read another CAM''s outreach preferences');

  -- CAM A cannot write CAM B's preferences
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.outreach_preferences (user_id) values (%L)', v_cam_b)),
    '42501',
    'a CAM cannot insert preferences on another CAM''s behalf'
  );

  -- F187: Admin CAN read any CAM's preferences to inspect their queue configuration
  perform tests.login_as(v_admin);
  select count(*) into v_count from public.outreach_preferences where user_id = v_cam_a;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 1::bigint, 'an admin can view a CAM''s outreach preferences (F187)');

  -- Viewer cannot read another CAM's preferences
  perform tests.login_as(v_viewer);
  select count(*) into v_count from public.outreach_preferences where user_id = v_cam_a;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return next is(v_count, 0::bigint, 'a viewer cannot read a CAM''s outreach preferences');
end;
$$;

select * from tests.suite_core();
select * from tests.suite_viewer();
select * from tests.suite_users();
select * from tests.suite_sensitive();
select * from tests.suite_ingestion();
select * from tests.suite_audit();
select * from tests.suite_role_rpc();
select * from tests.suite_active_rpc();
select * from tests.suite_deactivate_rpc();
select * from tests.suite_invite_rpc();
select * from tests.suite_signup_domain();
select * from tests.suite_default_role();
select * from tests.suite_views();
select * from tests.suite_actions();
select * from tests.suite_reassign();
select * from tests.suite_assign_client_owner();
select * from tests.suite_claim_ownership();
select * from tests.suite_outreach_status();
select * from tests.suite_offboard_unified();
select * from tests.suite_suppressions();
select * from tests.suite_ownership_requests();
select * from tests.suite_source_tracking();
select * from tests.suite_manual_entries();
select * from tests.suite_url_import();
select * from tests.suite_onboarding();
select * from tests.suite_outreach_preferences();
select * from tests.suite_client_criteria();
select * from tests.suite_data_handling_rules();
select * from tests.suite_personal_data_exclusion();

select * from finish();

rollback;
