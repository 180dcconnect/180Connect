-- list_restrictable_edit_fields tests (20261004120000). Run by `supabase test db`.
--
-- Runs as real end-user roles: both RPCs are SECURITY DEFINER, so testing them as
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

create or replace function tests.logout()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end;
$$;

create or replace function tests.restrictable_as(p_user_id uuid)
returns text[] language plpgsql as $$
declare v_fields text[];
begin
  perform tests.login_as(p_user_id);
  select array_agg(field_name) into v_fields from public.list_restrictable_edit_fields();
  perform tests.logout();
  return v_fields;
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
  perform tests.logout();
  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-a000-000000000301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rf-admin@180dc.org'),
  ('00000000-0000-4000-a000-000000000302', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rf-cam@180dc.org')
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, is_active)
values
  ('00000000-0000-4000-a000-000000000301', 'rf-admin@180dc.org', 'RF Admin', 'admin', true),
  ('00000000-0000-4000-a000-000000000302', 'rf-cam@180dc.org',   'RF CAM',   'cam',   true)
on conflict (id) do update
  set role = excluded.role,
      is_active = excluded.is_active,
      full_name = excluded.full_name;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

select ok(
  'legal_name' = any (tests.restrictable_as('00000000-0000-4000-a000-000000000301'))
  and 'trading_name' = any (tests.restrictable_as('00000000-0000-4000-a000-000000000301')),
  'an admin is offered ordinary text columns'
);

select ok(
  not (tests.restrictable_as('00000000-0000-4000-a000-000000000301')
       && array['id', 'owner_id', 'outreach_status', 'country_code', 'entry_method']),
  'protected system and provenance columns are never offered'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-a000-000000000302',
    'select * from public.list_restrictable_edit_fields()'),
  '42501',
  'a CAM cannot read the list'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-a000-000000000301',
    $q$select public.add_restricted_edit_field('country_code', 'test')$q$),
  '23514',
  'add_restricted_edit_field still refuses a protected column'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-a000-000000000301',
    $q$select public.add_restricted_edit_field('trading_name', 'Shown on outreach.')$q$),
  null,
  'add_restricted_edit_field still accepts an offered column'
);

select ok(
  not has_function_privilege('anon', 'public.list_restrictable_edit_fields()', 'execute'),
  'anon cannot execute list_restrictable_edit_fields'
);

select ok(
  not has_function_privilege('authenticated', 'app.restrictable_organisation_fields()', 'execute'),
  'client roles cannot call the helper directly'
);

select * from finish();

rollback;
