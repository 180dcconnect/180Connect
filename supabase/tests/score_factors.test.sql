-- Score Breakdown persistence tests — F095. Run by `supabase test db` (pg_prove).
--
-- Covers what migration 20260905100000 changes: the score_factors column exists
-- on latest_scores, accepts null (rows scored before F095) and a well-formed
-- {factors, weights} payload, and refuses payloads whose factor values are
-- missing, non-numeric or outside [0,1]. The constraint is the database's
-- guarantee that a persisted breakdown can always be trusted to reproduce its
-- priority_score — the application writer (persist-latest-score.ts) is the only
-- producer, but the shape rule lives here so nothing else can widen it.
--
-- Harness pattern copied from tag_colour.test.sql: pg_prove runs each file in
-- its own session and transaction, so there is nothing to import from.
--
-- Everything runs inside one transaction and is rolled back; fixtures never persist.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- One organisation is enough: latest_scores rows hang off it via FK.
create or replace function tests.seed_score_org()
returns uuid language plpgsql as $$
declare
  v_org uuid := '00000000-0000-4000-d000-000000000001';
begin
  insert into public.organisations (id, legal_name, entry_method, organisation_type)
  values (v_org, 'Score Breakdown Test Org', 'manual', 'charity')
  on conflict (id) do nothing;
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_score_factors()
returns setof text language plpgsql as $$
declare
  v_org uuid := '00000000-0000-4000-d000-000000000001';
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'latest_scores'
      and column_name = 'score_factors'
  ) then
    return next skip(1, 'latest_scores.score_factors not yet migrated');
    return;
  end if;

  perform tests.seed_score_org();

  -- Null stays legal: rows scored before F095 must not be forced to backfill.
  return next is(
    tests.sqlstate_of_null(
      format('insert into public.latest_scores (organisation_id) values (%L)', v_org)),
    null,
    'a latest_scores row without score_factors is still legal'
  );

  -- A well-formed payload passes the shape guard.
  return next is(
    tests.sqlstate_of_null(
      format('update public.latest_scores set score_factors = ''%s''::jsonb where organisation_id = %L',
        '{"factors": {"sector": 0.7, "geography": 0.5, "size": 0.5, "partnershipHistory": 0.5, "previousContact": 1}, "weights": {"sector": 0.2}}',
        v_org)),
    null,
    'a complete five-factor payload with weights is accepted'
  );

  return next is(
    (select score_factors -> 'factors' ->> 'sector' from public.latest_scores where organisation_id = v_org),
    '0.7',
    'the payload round-trips'
  );

  -- Missing keys, non-numeric values and out-of-range values are all refused.
  return next is(
    tests.sqlstate_of_null(
      format('update public.latest_scores set score_factors = ''%s''::jsonb where organisation_id = %L',
        '{"factors": {"geography": 0.5, "size": 0.5, "partnershipHistory": 0.5, "previousContact": 1}, "weights": {}}',
        v_org)),
    '23514',
    'a payload missing the sector factor is refused'
  );

  return next is(
    tests.sqlstate_of_null(
      format('update public.latest_scores set score_factors = ''%s''::jsonb where organisation_id = %L',
        '{"factors": {"sector": "high", "geography": 0.5, "size": 0.5, "partnershipHistory": 0.5, "previousContact": 1}, "weights": {}}',
        v_org)),
    '23514',
    'a non-numeric factor value is refused'
  );

  return next is(
    tests.sqlstate_of_null(
      format('update public.latest_scores set score_factors = ''%s''::jsonb where organisation_id = %L',
        '{"factors": {"sector": 1.4, "geography": 0.5, "size": 0.5, "partnershipHistory": 0.5, "previousContact": 1}, "weights": {}}',
        v_org)),
    '23514',
    'a factor above 1 is refused'
  );

  return next is(
    tests.sqlstate_of_null(
      format('update public.latest_scores set score_factors = ''%s''::jsonb where organisation_id = %L',
        '"0.72"',
        v_org)),
    '23514',
    'a bare scalar instead of an object is refused'
  );

  -- Clearing the breakdown is allowed; it just means "scored before F095" again.
  return next is(
    tests.sqlstate_of_null(
      format('update public.latest_scores set score_factors = null where organisation_id = %L', v_org)),
    null,
    'score_factors can be cleared back to null'
  );
end;
$$;

-- sqlstate helper local to this suite: run a statement and report the SQLSTATE
-- it raised, or null if it succeeded (runs as the harness's superuser role —
-- latest_scores has no write grants for authenticated by design).
create or replace function tests.sqlstate_of_null(p_sql text)
returns text language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_sql;
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  return v_state;
end;
$$;

select tests.suite_score_factors();

select * from finish();
rollback;
