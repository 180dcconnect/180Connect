-- data_handling_observed_fields tests (20261004130000). Run by `supabase test db`.
--
-- Runs as real end-user roles: the RPC is SECURITY DEFINER, so testing it as a
-- superuser would exercise a code path no user can reach.

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

-- No tests.logout() helper here on purpose: while impersonating, the session
-- IS `authenticated`, which has no USAGE on schema `tests`, so it cannot call
-- one (see rls_policies.test.sql). Dropping back is inlined at each call site.
create or replace function tests.observed_paths(p_user_id uuid, p_source text)
returns text[] language plpgsql as $$
declare v_paths text[];
begin
  perform tests.login_as(p_user_id);
  select array_agg(field_path order by field_path) into v_paths
    from public.data_handling_observed_fields(p_source);
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_paths;
end;
$$;

create or replace function tests.observed_seen(p_user_id uuid, p_source text, p_path text)
returns bigint language plpgsql as $$
declare v_seen bigint;
begin
  perform tests.login_as(p_user_id);
  select records_seen into v_seen
    from public.data_handling_observed_fields(p_source)
   where field_path = p_path;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_seen;
end;
$$;

create or replace function tests.observed_sqlstate(p_user_id uuid, p_source text)
returns text language plpgsql as $$
declare v_state text;
begin
  perform tests.login_as(p_user_id);
  begin
    perform * from public.data_handling_observed_fields(p_source);
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
-- Fixtures: an admin, a CAM, and two Companies House records of different shape.
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-a000-000000000401', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'of-admin@180dc.org'),
  ('00000000-0000-4000-a000-000000000402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'of-cam@180dc.org')
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, is_active)
values
  ('00000000-0000-4000-a000-000000000401', 'of-admin@180dc.org', 'OF Admin', 'admin', true),
  ('00000000-0000-4000-a000-000000000402', 'of-cam@180dc.org',   'OF CAM',   'cam',   true)
on conflict (id) do update
  set role = excluded.role,
      is_active = excluded.is_active,
      full_name = excluded.full_name;

insert into public.ingestion_runs (id, api_source, triggered_by, job_status)
values ('00000000-0000-4000-e000-000000000401', 'companies_house', 'manual', 'completed')
on conflict (id) do nothing;

insert into public.raw_source_records
  (ingestion_run_id, record_source, source_record_id, raw_payload, checksum)
values
  ('00000000-0000-4000-e000-000000000401', 'companies_house', 'OF-TEST-1',
   '{"company_name": "Acme Trust",
     "registered_office_address": {"locality": "Sheffield", "postal_code": "S1 1AA"},
     "officers": [{"name": "Jane Private", "role": "director"}],
     "sic_codes": ["85590"]}'::jsonb,
   'of-test-1'),
  ('00000000-0000-4000-e000-000000000401', 'companies_house', 'OF-TEST-2',
   '{"company_name": "Beta CIC",
     "officers": [{"name": "John Private", "appointed_on": "2020-01-01"}]}'::jsonb,
   'of-test-2')
on conflict (record_source, source_record_id) do nothing;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

select ok(
  tests.observed_paths('00000000-0000-4000-a000-000000000401', 'companies_house')
    @> array['company_name', 'registered_office_address.locality', 'officers[*].name',
             'officers[*].appointed_on', 'sic_codes'],
  'lists top-level, nested and array-of-object field paths in the filter''s syntax'
);

select ok(
  not (tests.observed_paths('00000000-0000-4000-a000-000000000401', 'companies_house')
       && array['officers', 'registered_office_address']),
  'does not list a container as a field of its own'
);

select ok(
  tests.observed_seen('00000000-0000-4000-a000-000000000401', 'companies_house', 'officers[*].name') >= 2
  and tests.observed_seen('00000000-0000-4000-a000-000000000401', 'companies_house', 'officers[*].appointed_on') >= 1,
  'counts how many sampled records contain each field'
);

select ok(
  not exists (
    select 1
      from unnest(tests.observed_paths('00000000-0000-4000-a000-000000000401', 'companies_house')) p
     where p ilike '%Private%' or p ilike '%Sheffield%'
  ),
  'never returns a payload value'
);

select is(
  tests.observed_sqlstate('00000000-0000-4000-a000-000000000402', 'companies_house'),
  '42501',
  'a CAM cannot read the fields a source has sent'
);

select is(
  tests.observed_sqlstate('00000000-0000-4000-a000-000000000401', ''),
  '22023',
  'a blank source is refused'
);

select ok(
  not has_function_privilege('anon', 'public.data_handling_observed_fields(text)', 'execute'),
  'anon cannot execute data_handling_observed_fields'
);

select * from finish();

rollback;
