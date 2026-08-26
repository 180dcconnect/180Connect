-- AI generation rate-limit RPC behaviour tests — F227 (#222).
-- Spec: docs/audit-log-pattern.md. Run by `supabase test db`.
--
-- Covers public.consume_ai_generation_allowance. The review gap this closes:
-- the window-reset and blocked logic lives in SQL, and until now was only
-- exercised through a mocked app-level RPC client — an SQL bug in the upsert
-- would have passed every TS test.
--
-- Unlike the outreach RPC suites this MUST run its assertions as service_role,
-- because EXECUTE is granted to service_role alone (the authorisation model is
-- the grant itself plus server-derived user ids, not auth.uid()). The fixture
-- writes run as the migration-owner role before dropping privileges.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

create schema if not exists tests;

-- Runs SQL under an explicit role; captures sqlstate and first result column.
create or replace function tests.run_as(p_role text, p_sql text)
returns table(state text, result text)
language plpgsql as $$
declare
  v_result text;
  v_state text;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_result;
    v_state := null;
  exception when others then
    v_state := sqlstate;
    v_result := null;
  end;
  execute 'reset role';
  return query select v_state, v_result;
end;
$$;

create or replace function tests.seed_rate_limit()
returns void language plpgsql as $$
declare
  v_user uuid := '00000000-0000-4000-a000-000000000021';
  v_inactive uuid := '00000000-0000-4000-a000-000000000022';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_user,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rl-a@180dc.org'),
    (v_inactive,'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rl-b@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_user,    'rl-a@180dc.org', 'Rate Limit A', 'cam', true),
    (v_inactive,'rl-b@180dc.org', 'Rate Limit B', 'cam', false)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active;
end;
$$;

create or replace function tests.suite_ai_generation_rate_limit()
returns setof text language plpgsql as $$
declare
  v_user     uuid := '00000000-0000-4000-a000-000000000021';
  v_inactive uuid := '00000000-0000-4000-a000-000000000022';
  v_state text;
  v_result text;
begin
  if to_regprocedure('public.consume_ai_generation_allowance(uuid,integer,integer)') is null then
    return next skip(1, 'ai rate-limit RPC not yet migrated');
    return;
  end if;

  perform tests.seed_rate_limit();

  -- Authorisation boundary: EXECUTE granted to service_role alone.
  select * into v_state, v_result from tests.run_as(
    'authenticated',
    format('select public.consume_ai_generation_allowance(%L, 3, 3600)', v_user)
  );
  return next is(v_state, '42501',
    'EXECUTE refused to plain authenticated users — the service_role-only grant holds');

  -- First consumption allowed, counter row created at 1.
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select coalesce(public.consume_ai_generation_allowance(%L, 3, 3600)::text, ''ALLOWED'')', v_user)
  );
  return next is(v_state, null, 'a healthy RPC call raises nothing');
  return next is(v_result, 'ALLOWED', 'the first request within a window is allowed');
  return next is(
    (select request_count from public.ai_generation_rate_limit where user_id = v_user),
    1,
    'the counter row was created at count 1'
  );

  -- Second allowed; third (exactly at limit 3) still allowed; fourth blocked.
  perform tests.run_as('service_role',
    format('select public.consume_ai_generation_allowance(%L, 3, 3600)', v_user));
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select coalesce(public.consume_ai_generation_allowance(%L, 3, 3600)::text, ''ALLOWED'')', v_user)
  );
  return next is(v_result, 'ALLOWED', 'a request exactly AT the limit is still allowed');

  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select public.consume_ai_generation_allowance(%L, 3, 3600)::text', v_user)
  );
  return next is(v_state, null, 'the over-limit call itself does not error');
  return next isnt(v_result, 'ALLOWED', 'over-limit returns a reset timestamp, not success');
  return next ok(v_result::timestamptz > now(), 'the reset timestamp lies in the future');

  -- Window expiry restarts the count even though the row carries a stale total.
  update public.ai_generation_rate_limit
     set window_started_at = now() - interval '2 hours',
         request_count = 99
   where user_id = v_user;

  perform tests.run_as('service_role',
    format('select coalesce(public.consume_ai_generation_allowance(%L, 3, 3600)::text, '''')', v_user));
  return next is(
    (select request_count from public.ai_generation_rate_limit where user_id = v_user),
    1,
    'an expired window restarts at 1 regardless of the stale count'
  );

  -- Configuration guard.
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select public.consume_ai_generation_allowance(%L, 0, 3600)', v_user)
  );
  return next is(v_state, 'P0001',
    'non-positive limit configuration raises rather than silently allowing everything');

  -- Inactive accounts cannot consume allowance.
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select public.consume_ai_generation_allowance(%L, 3, 3600)', v_inactive)
  );
  return next is(v_state, '42501', 'inactive users are refused inside the SECURITY DEFINER body');

  -- Atomicity smoke: five consumes land exactly five increments within a window.
  delete from public.ai_generation_rate_limit where user_id = v_user;
  for i in 1..5 loop
    perform tests.run_as('service_role',
      format('select public.consume_ai_generation_allowance(%L, 10, 3600)', v_user));
  end loop;
  return next is(
    (select request_count from public.ai_generation_rate_limit where user_id = v_user),
    5,
    'five consumes land exactly five increments — no lost or doubled counts'
  );
end;
$$;

select * from tests.suite_ai_generation_rate_limit();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();
