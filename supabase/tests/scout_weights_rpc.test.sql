-- Scout weights RPC tests — F096. Run by `supabase test db` (pg_prove).
--
-- Covers public.set_scout_weights: the admin-only authorisation (re-checked
-- inside the SECURITY DEFINER body, since RLS cannot do it), the versioning
-- contract (old SCOUT generation retired, new one active — history, not an
-- edit), the same-transaction audit_log row, no-op submissions writing nothing,
-- and the shape validation that keeps an all-zero or malformed submission from
-- flattening every score.
--
-- The harness below follows tag_colour.test.sql's copy-don't-import convention:
-- pg_prove runs each file in its own session and transaction, so there is
-- nothing to import from — and a shared harness would couple suites meant to
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

-- Call the RPC as a user and hand back its uuid result.
create or replace function tests.set_weights_as(p_user_id uuid, p_weights jsonb)
returns uuid language plpgsql as $$
declare v_result uuid;
begin
  perform tests.login_as(p_user_id);
  select public.set_scout_weights(p_weights) into v_result;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- One admin, one CAM, one viewer. The SCOUT generation to reweight away from is
-- whichever row the migrations already seeded as active (the suite reads it at
-- runtime rather than hard-coding v1); a fallback fixture covers a database
-- where none exists yet.

create or replace function tests.seed_weights()
returns void language plpgsql as $$
declare
  v_admin  uuid := '00000000-0000-4000-a000-000000000001';
  v_cam    uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer uuid := '00000000-0000-4000-a000-000000000005';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@180dc.org'),
    (v_cam,    '00000000-0000-4000-a000-000000000002', 'authenticated', 'authenticated', 'cam-a@180dc.org'),
    (v_viewer, '00000000-0000-4000-a000-000000000005', 'authenticated', 'authenticated', 'viewer@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin,  'admin@180dc.org',  'Test Admin',  'admin',  true),
    (v_cam,    'cam-a@180dc.org',  'Test CAM A',  'cam',    true),
    (v_viewer, 'viewer@180dc.org', 'Test Viewer', 'viewer', true)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name;

  -- Only if no active generation exists (migrations normally leave SCOUT v1).
  insert into public.model_versions
    (model_name, version, implementation_type, config, is_active, notes)
  select 'SCOUT', 'v9000fixture', 'rules',
         '{"weights": {"sector": 0.25, "geography": 0.25, "size": 0.25, "previousContact": 0.25},
           "bands": {"high": 0.70, "medium": 0.40}}'::jsonb,
         true,
         'F096 test fixture'
  where not exists (
    select 1 from public.model_versions where model_name = 'SCOUT' and is_active
  );
end;
$$;

-- The five-way equal submission used throughout the suite.
create or replace function tests.equal_five()
returns jsonb language sql as $$
  select '{"sector": 0.2, "geography": 0.2, "size": 0.2,
           "partnershipHistory": 0.2, "previousContact": 0.2}'::jsonb;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_scout_weights()
returns setof text language plpgsql as $$
declare
  v_admin     uuid := '00000000-0000-4000-a000-000000000001';
  v_cam       uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer    uuid := '00000000-0000-4000-a000-000000000005';
  v_v1        uuid;
  v_new_id    uuid;
  v_audit     record;
  v_versions_before bigint;
  v_audits_before   bigint;
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if to_regprocedure('public.set_scout_weights(jsonb)') is null then
    return next skip(1, 'set_scout_weights not yet migrated');
    return;
  end if;

  perform tests.seed_weights();

  select id into v_v1
    from public.model_versions
   where model_name = 'SCOUT' and is_active
   limit 1;

  select count(*), (select count(*) from public.audit_log where action = 'scout_weights_changed')
    into v_versions_before, v_audits_before
    from public.model_versions
   where model_name = 'SCOUT';

  -- AC / open question resolved: only admins edit weights. The refusals must
  -- come from the function body itself (42501), not merely RLS — anyone can
  -- reach the RPC through PostgREST.
  return next is(
    tests.sqlstate_of(
      v_cam,
      'select public.set_scout_weights(tests.equal_five())'
    ),
    '42501',
    'a CAM cannot change scoring weights'
  );

  return next is(
    tests.sqlstate_of(
      v_viewer,
      'select public.set_scout_weights(tests.equal_five())'
    ),
    '42501',
    'a viewer cannot change scoring weights'
  );

  -- Shape validation before any write: bad submissions are refused outright.
  return next is(
    tests.sqlstate_of(
      v_admin,
      'select public.set_scout_weights(''{"sector": 2}''::jsonb)'
    ),
    '22023',
    'an incomplete weights object is refused'
  );

  return next is(
    tests.sqlstate_of(
      v_admin,
      'select public.set_scout_weights(''{"sector": 5, "geography": 0.2, "size": 0.2, "partnershipHistory": 0.2, "previousContact": 0.2}''::jsonb)'
    ),
    '22023',
    'a weight above 1 is refused'
  );

  return next is(
    tests.sqlstate_of(
      v_admin,
      'select public.set_scout_weights(''{"sector": 0, "geography": 0, "size": 0, "partnershipHistory": 0, "previousContact": 0}''::jsonb)'
    ),
    '22023',
    'an all-zero submission is refused'
  );

  return next is(
    tests.sqlstate_of(v_admin, 'select public.set_scout_weights(''[]''::jsonb)'),
    '22023',
    'a non-object payload is refused'
  );

  return next is(
    tests.sqlstate_of(
      v_admin,
      'select public.set_scout_weights(''{"sector": 0.2, "geography": 0.2, "size": 0.2, "partnershipHistory": 0.2, "previousContact": 0.2, "junk": 1}''::jsonb)'
    ),
    '22023',
    'unknown keys are refused rather than stored into the history'
  );

  -- The happy path: the write happens, versions rather than edits.
  v_new_id := tests.set_weights_as(v_admin, tests.equal_five());
  return next isnt(v_new_id, null, 'an admin saves new weights successfully');
  return next isnt(v_new_id, v_v1, 'the save produces a NEW generation, not an edit of v1');

  return next is(
    (select is_active from public.model_versions where id = v_v1),
    false,
    'the previous generation is retired (is_active false)'
  );

  return next is(
    (select deprecated_at is not null from public.model_versions where id = v_v1),
    true,
    'the previous generation carries deprecated_at'
  );

  return next is(
    (select count(*) from public.model_versions where model_name = 'SCOUT' and is_active),
    1::bigint,
    'exactly one SCOUT generation is active afterwards'
  );

  return next is(
    (select config -> 'weights' from public.model_versions where id = v_new_id),
    tests.equal_five(),
    'the new generation stores the submitted weights verbatim'
  );

  return next is(
    (select config - 'weights' from public.model_versions where id = v_new_id),
    '{}'::jsonb,
    'the new generation stores weights only — no decorative bands key'
  );

  -- AC3: who changed what, and when — in the same transaction as the write.
  select * into v_audit
    from public.audit_log
   where target_id = v_new_id and action = 'scout_weights_changed';
  return next is(
    (select count(*) from public.audit_log where target_id = v_new_id and action = 'scout_weights_changed'),
    1::bigint,
    'exactly one audit row records the change'
  );
  return next is(v_audit.actor_user_id, v_admin, 'the audit row names the acting admin');
  return next is(
    v_audit.detail ->> 'from_version',
    (select version from public.model_versions where id = v_v1),
    'the audit detail names the generation replaced'
  );
  return next is(
    v_audit.detail -> 'from' ->> 'sector',
    '0.25',
    'the audit detail captures the old weights'
  );
  return next is(
    v_audit.detail -> 'to' -> 'partnershipHistory',
    '0.2',
    'the audit detail captures the new weights'
  );

  -- The no-op resubmission writes nothing and audits nothing.
  return next is(
    tests.set_weights_as(v_admin, tests.equal_five()),
    v_new_id,
    'resubmitting the active weights is an accepted no-op'
  );
  return next is(
    (select count(*) from public.model_versions where model_name = 'SCOUT'),
    v_versions_before + 1,
    'the no-op created no extra version row'
  );
  return next is(
    (select count(*) from public.audit_log where action = 'scout_weights_changed'),
    v_audits_before + 1,
    'the no-op wrote no audit noise'
  );
end;
$$;

select tests.suite_scout_weights();

select * from finish();
rollback;
