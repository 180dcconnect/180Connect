-- Per-feature rate-limit buckets — F214 (#209).
-- Covers the 4-argument public.consume_ai_generation_allowance overload added by
-- 20260925090000_add_rate_limit_bucket.sql. Run by `supabase test db`.
--
-- The property worth proving in SQL rather than in TypeScript is *isolation*:
-- the whole reason the bucket exists is that a CAM running twenty searches must
-- still be able to generate a booklet. That is a claim about the upsert's
-- conflict target, which no mocked RPC client can check.
--
-- Runs as service_role for the same reason the F227 suite does: EXECUTE is
-- granted to service_role alone.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

create schema if not exists tests;

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

create or replace function tests.seed_bucket_user()
returns void language plpgsql as $$
declare
  v_user uuid := '00000000-0000-4000-a000-000000000031';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rl-bucket@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values (v_user, 'rl-bucket@180dc.org', 'Rate Limit Bucket', 'cam', true)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active;
end;
$$;

create or replace function tests.suite_ai_rate_limit_buckets()
returns setof text language plpgsql as $$
declare
  v_user uuid := '00000000-0000-4000-a000-000000000031';
  v_state text;
  v_result text;
begin
  if to_regprocedure('public.consume_ai_generation_allowance(uuid,integer,integer,text)') is null then
    return next skip(1, 'bucketed rate-limit RPC not yet migrated');
    return;
  end if;

  perform tests.seed_bucket_user();
  delete from public.ai_generation_rate_limit where user_id = v_user;

  -- Same authorisation boundary as the 3-argument original.
  select * into v_state, v_result from tests.run_as(
    'authenticated',
    format('select public.consume_ai_generation_allowance(%L, 3, 3600, ''search'')', v_user)
  );
  return next is(v_state, '42501',
    'EXECUTE on the bucketed overload is refused to plain authenticated users');

  -- Exhaust the search bucket completely.
  for i in 1..3 loop
    perform tests.run_as('service_role',
      format('select public.consume_ai_generation_allowance(%L, 3, 3600, ''search'')', v_user));
  end loop;
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select coalesce(public.consume_ai_generation_allowance(%L, 3, 3600, ''search'')::text, ''ALLOWED'')', v_user)
  );
  return next isnt(v_result, 'ALLOWED', 'a fourth search against a limit of three is blocked');

  -- ...and the generation bucket must be completely untouched by that. This is
  -- the regression the whole migration exists to prevent.
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select coalesce(public.consume_ai_generation_allowance(%L, 3, 3600, ''generation'')::text, ''ALLOWED'')', v_user)
  );
  return next is(v_result, 'ALLOWED',
    'an exhausted search bucket leaves the booklet/draft allowance intact');

  return next is(
    (select count(*)::int from public.ai_generation_rate_limit where user_id = v_user),
    2,
    'one counter row per user per bucket');

  return next is(
    (select request_count from public.ai_generation_rate_limit
      where user_id = v_user and bucket = 'search'),
    4,
    'the search counter counted every search, including the blocked one');

  return next is(
    (select request_count from public.ai_generation_rate_limit
      where user_id = v_user and bucket = 'generation'),
    1,
    'the generation counter counted only the generation');

  -- The retained 3-argument signature must land in the generation bucket, or
  -- every existing caller would silently start a fresh counter.
  perform tests.run_as('service_role',
    format('select public.consume_ai_generation_allowance(%L, 10, 3600)', v_user));
  return next is(
    (select request_count from public.ai_generation_rate_limit
      where user_id = v_user and bucket = 'generation'),
    2,
    'the 3-argument overload keeps writing to the generation bucket');

  -- An empty or blank bucket name falls back rather than creating a nameless row.
  perform tests.run_as('service_role',
    format('select public.consume_ai_generation_allowance(%L, 10, 3600, ''  '')', v_user));
  return next is(
    (select count(*)::int from public.ai_generation_rate_limit where user_id = v_user),
    2,
    'a blank bucket name resolves to generation rather than creating a third row');
end;
$$;

select * from tests.suite_ai_rate_limit_buckets();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();
