-- set_scout_config tests (20261004170000). Run by `supabase test db`.
--
-- Runs as real end-user roles: the RPCs are SECURITY DEFINER, so testing them as
-- a superuser would exercise a code path no user can reach.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

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

-- set_scout_config takes a jsonb argument, and every call site below builds
-- that argument from tests.valid_config(). The config must be resolved BEFORE
-- impersonating: while logged in, the session IS `authenticated`, which has no
-- USAGE on schema `tests`, so `tests.valid_config()` inside the executed SQL
-- dies with 42501 before the RPC is ever reached (same trap as tests.logout()
-- in rls_policies.test.sql). This helper takes the already-built config, so
-- callers evaluate valid_config() as themselves and only the RPC runs as the
-- user under test.
create or replace function tests.scout_sqlstate(p_user_id uuid, p_config jsonb)
returns text language plpgsql as $$
declare v_state text;
begin
  perform tests.login_as(p_user_id);
  begin
    perform public.set_scout_config(p_config);
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

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-a000-000000000501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sc-admin@180dc.org'),
  ('00000000-0000-4000-a000-000000000502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sc-cam@180dc.org')
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, is_active)
values
  ('00000000-0000-4000-a000-000000000501', 'sc-admin@180dc.org', 'SC Admin', 'admin', true),
  ('00000000-0000-4000-a000-000000000502', 'sc-cam@180dc.org',   'SC CAM',   'cam',   true)
on conflict (id) do update
  set role = excluded.role,
      is_active = excluded.is_active,
      full_name = excluded.full_name;

-- The migrations seed an active SCOUT v1; make sure one exists regardless.
do $$
begin
  if not exists (select 1 from public.model_versions where model_name = 'SCOUT' and is_active) then
    insert into public.model_versions (model_name, version, implementation_type, config, is_active)
    values ('SCOUT', 'v900', 'rules',
            '{"weights":{"sector":0.2,"geography":0.2,"size":0.2,"partnershipHistory":0.2,"previousContact":0.2}}',
            true);
  end if;
end;
$$;

create or replace function tests.valid_config()
returns jsonb language sql as $$
  select $j${
    "weights": {"sector": 0.3, "geography": 0.2, "size": 0.2, "partnershipHistory": 0.15, "previousContact": 0.15},
    "sectorScores": {
      "Health & Wellbeing": 0.4, "Education & Youth": 0.7, "Poverty & Community": 0.65,
      "Social Justice & Enterprise": 0.6, "Environment & Sustainability": 0.55, "Arts, Culture & Heritage": 0.45
    },
    "geography": {"priorityTowns": ["Leeds"], "insideScore": 0.9, "outsideScore": 0.2},
    "sizeScores": {"under_10k": 0.8, "10k_100k": 0.6, "100k_500k": 0.5, "500k_1m": 0.4, "1m_10m": 0.3, "10m_50m": 0.25, "50m_100m": 0.2, "over_100m": 0.1}
  }$j$::jsonb;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

select is(
  tests.scout_sqlstate('00000000-0000-4000-a000-000000000501', tests.valid_config()),
  null,
  'an admin can save a complete scoring setup'
);

select is(
  (select config -> 'geography' -> 'priorityTowns' from public.model_versions
    where model_name = 'SCOUT' and is_active),
  '["Leeds"]'::jsonb,
  'the saved setup becomes the active SCOUT version'
);

select ok(
  exists (select 1 from public.audit_log where action = 'scout_config_changed'
           and actor_user_id = '00000000-0000-4000-a000-000000000501'),
  'the change is audited'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-a000-000000000501',
    $q$select public.set_scout_weights('{"sector":0.5,"geography":0.1,"size":0.1,"partnershipHistory":0.2,"previousContact":0.1}')$q$),
  null,
  'set_scout_weights still works'
);

select is(
  (select config -> 'sectorScores' ->> 'Education & Youth' from public.model_versions
    where model_name = 'SCOUT' and is_active),
  '0.7',
  'set_scout_weights keeps the sector scores instead of resetting them'
);

select is(
  tests.scout_sqlstate('00000000-0000-4000-a000-000000000502', tests.valid_config()),
  '42501',
  'a CAM cannot change the scoring setup'
);

select is(
  tests.scout_sqlstate('00000000-0000-4000-a000-000000000501',
    tests.valid_config() #- '{sectorScores,Education & Youth}' || '{"sectorScores":{"Made Up":0.5}}'),
  '22023',
  'an unknown sector is refused'
);

select is(
  tests.scout_sqlstate('00000000-0000-4000-a000-000000000501',
    jsonb_set(tests.valid_config(), '{geography,priorityTowns}', '["  "]')),
  '22023',
  'a blank priority town is refused'
);

select is(
  tests.scout_sqlstate('00000000-0000-4000-a000-000000000501',
    jsonb_set(tests.valid_config(), '{sizeScores,over_10m}', '1.5')),
  '22023',
  'a size score above 1 is refused'
);

select ok(
  not has_function_privilege('anon', 'public.set_scout_config(jsonb)', 'execute'),
  'anon cannot execute set_scout_config'
);

select * from finish();

rollback;
