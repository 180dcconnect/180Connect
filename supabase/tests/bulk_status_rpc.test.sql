-- Bulk pipeline status behaviour tests — F064 (#66)
-- Spec: docs/rls-permission-matrix.md §2/§3.2. Run by `supabase test db` (pg_prove).
--
-- Covers public.set_outreach_status_bulk, the RPC behind the bulk bar on /clients.
-- The three things worth a database test rather than a unit test are all here:
-- the permission rule holds across a whole batch, a refused batch applies *nothing*
-- (the property that makes an atomic bulk write safer than a loop of single ones),
-- and no-ops are neither written nor audited.
--
-- Like rls_policies.test.sql these run as real end-user roles, never as
-- service_role or the owning role: the RPC is SECURITY DEFINER, so testing it as a
-- superuser would exercise a code path no user can reach and prove nothing about
-- the checks inside it.
--
-- The harness below is a deliberate copy of that file's rather than an import.
-- pg_prove runs each file in its own session and transaction, so there is nothing
-- to import from — and a shared harness would couple two suites that are meant to
-- fail independently.
--
-- Everything runs inside one transaction and is rolled back; fixtures never persist.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------

create schema if not exists tests;

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

-- Run a statement as a user and report the SQLSTATE it raised, or null if it
-- succeeded. Every refusal below is asserted by code, not by message text.
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

-- Call the RPC as a user and hand back its jsonb result.
create or replace function tests.bulk_as(p_user_id uuid, p_ids uuid[], p_status text)
returns jsonb language plpgsql as $$
declare v_result jsonb;
begin
  perform tests.login_as(p_user_id);
  select public.set_outreach_status_bulk(p_ids, p_status::public.outreach_status) into v_result;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Three CAM A clients (two on not_contacted, one already on responded — the no-op
-- case), one CAM B client, one unowned. Enough to express every branch.

create or replace function tests.seed_bulk()
returns void language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b       uuid := '00000000-0000-4000-a000-000000000003';
  v_deactivated uuid := '00000000-0000-4000-a000-000000000004';
begin
  -- public.users.id references auth.users, and create_users mirrors an auth.users
  -- insert into public.users by trigger — hence ON CONFLICT DO UPDATE to set the
  -- role the trigger's default row would not carry. Emails are @180dc.org because
  -- F002 rejects every other domain at insert time.
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@180dc.org'),
    (v_cam_a,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a@180dc.org'),
    (v_cam_b,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b@180dc.org'),
    (v_deactivated, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gone@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin,       'admin@180dc.org', 'Test Admin',       'admin', true),
    (v_cam_a,       'cam-a@180dc.org', 'Test CAM A',       'cam',   true),
    (v_cam_b,       'cam-b@180dc.org', 'Test CAM B',       'cam',   true),
    (v_deactivated, 'gone@180dc.org',  'Deactivated User', 'cam',   false)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values
    ('00000000-0000-4000-c000-000000000001', 'CAM A One',   'manual', 'other', v_cam_a, 'not_contacted'),
    ('00000000-0000-4000-c000-000000000002', 'CAM A Two',   'manual', 'other', v_cam_a, 'not_contacted'),
    ('00000000-0000-4000-c000-000000000003', 'CAM A Three', 'manual', 'other', v_cam_a, 'responded'),
    ('00000000-0000-4000-c000-000000000004', 'CAM B One',   'manual', 'other', v_cam_b, 'not_contacted'),
    ('00000000-0000-4000-c000-000000000005', 'Unowned One', 'manual', 'other', null,    'not_contacted')
  on conflict (id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_bulk_status()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_deactivated uuid := '00000000-0000-4000-a000-000000000004';
  v_a1 uuid := '00000000-0000-4000-c000-000000000001';
  v_a2 uuid := '00000000-0000-4000-c000-000000000002';
  v_a3 uuid := '00000000-0000-4000-c000-000000000003';
  v_b1 uuid := '00000000-0000-4000-c000-000000000004';
  v_unowned uuid := '00000000-0000-4000-c000-000000000005';
  v_missing uuid := '00000000-0000-4000-c000-0000000000ff';
  v_many uuid[];
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if to_regprocedure('public.set_outreach_status_bulk(uuid[], public.outreach_status)') is null then
    return next skip(1, 'set_outreach_status_bulk not yet migrated');
    return;
  end if;

  perform tests.seed_bulk();

  -- AC1 + the no-op convention, in one call: three selected, two real moves.
  return next is(
    tests.bulk_as(v_cam_a, array[v_a1, v_a2, v_a3], 'responded'),
    jsonb_build_object('requested', 3, 'changed', 2, 'unchanged', 1),
    'a CAM moves three of their own clients; the one already there is reported as unchanged'
  );

  return next is(
    (select count(*)::int from public.organisations
      where id in (v_a1, v_a2, v_a3) and outreach_status = 'responded'),
    3,
    'all three clients ended on the chosen status'
  );

  return next is(
    (select count(*)::int from public.audit_log
      where action = 'status_changed' and target_id in (v_a1, v_a2, v_a3)),
    2,
    'one audit row per real transition — the no-op is not audited'
  );

  return next is(
    (select count(*)::int from public.audit_log
      where action = 'status_changed'
        and target_id in (v_a1, v_a2)
        and actor_user_id = v_cam_a
        and target_table = 'organisations'
        and detail->>'from' = 'not_contacted'
        and detail->>'to' = 'responded'
        and detail->>'trigger' = 'bulk_update'),
    2,
    'each audit row names the actor and the status the client actually came from'
  );

  return next is(
    tests.bulk_as(v_cam_a, array[v_a1, v_a2], 'responded'),
    jsonb_build_object('requested', 2, 'changed', 0, 'unchanged', 2),
    'repeating the same change is a clean no-op rather than an error'
  );

  return next is(
    (select count(*)::int from public.audit_log
      where action = 'status_changed' and target_id in (v_a1, v_a2)),
    2,
    'the repeat wrote no further audit rows'
  );

  return next is(
    tests.bulk_as(v_cam_a, array[v_a1, v_a1], 'converted'),
    jsonb_build_object('requested', 1, 'changed', 1, 'unchanged', 0),
    'a duplicated id counts once, so the reported total matches what was confirmed'
  );

  -- The permission rule, applied to a batch rather than a row.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status_bulk(array[%L, %L]::uuid[], ''hard_no''::public.outreach_status)',
      v_a2, v_b1)),
    '42501',
    'a batch holding another CAM''s client is refused'
  );

  -- The property the whole design exists for: a refused batch changes nothing,
  -- including the rows the caller *was* entitled to change.
  return next is(
    (select array_agg(outreach_status::text order by id) from public.organisations
      where id in (v_a2, v_b1)),
    array['responded', 'not_contacted'],
    'the refused batch left both halves untouched — no partial application'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status_bulk(array[%L]::uuid[], ''hard_no''::public.outreach_status)',
      v_unowned)),
    '42501',
    'an unowned client is not the CAM''s to change in bulk either — they claim it first'
  );

  return next is(
    tests.sqlstate_of(v_cam_a,
      'select public.set_outreach_status_bulk(array[]::uuid[], ''responded''::public.outreach_status)'),
    '22023',
    'an empty selection is refused rather than silently doing nothing'
  );

  return next is(
    tests.sqlstate_of(v_cam_a,
      'select public.set_outreach_status_bulk(null, ''responded''::public.outreach_status)'),
    '22023',
    'a null selection is refused the same way'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status_bulk(array[%L, %L]::uuid[], ''responded''::public.outreach_status)',
      v_a1, v_missing)),
    'P0002',
    'a batch naming a client that does not exist fails whole'
  );

  select array_agg(gen_random_uuid()) into v_many from generate_series(1, 501);
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status_bulk(%L::uuid[], ''responded''::public.outreach_status)', v_many)),
    '22023',
    '501 clients trips the ceiling — the blast radius is bounded'
  );

  return next is(
    tests.bulk_as(v_admin, array[v_b1, v_unowned], 'soft_no'),
    jsonb_build_object('requested', 2, 'changed', 2, 'unchanged', 0),
    'an admin may move clients they do not own, as they can one at a time'
  );

  return next is(
    tests.sqlstate_of(v_deactivated, format(
      'select public.set_outreach_status_bulk(array[%L]::uuid[], ''responded''::public.outreach_status)',
      v_a1)),
    '42501',
    'a deactivated account cannot bulk update, even holding a valid token'
  );

  -- AC3: an invalid or undefined status cannot be set. The enum parameter does
  -- this before the body runs — there is no code path that could accept one.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status_bulk(array[%L]::uuid[], ''wildly_invented_status''::public.outreach_status)',
      v_a1)),
    '22P02',
    'an undefined status is rejected by the enum, not by application code'
  );

  return next ok(
    has_function_privilege('authenticated',
      'public.set_outreach_status_bulk(uuid[], public.outreach_status)', 'execute'),
    'authenticated may call the RPC — the body decides who succeeds'
  );

  return next ok(
    not has_function_privilege('anon',
      'public.set_outreach_status_bulk(uuid[], public.outreach_status)', 'execute'),
    'anon may not call the RPC at all'
  );
end;
$$;

select tests.suite_bulk_status();

select * from finish();
rollback;
