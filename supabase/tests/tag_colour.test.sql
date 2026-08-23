-- Tag colour tests — F194. Run by `supabase test db` (pg_prove).
--
-- Covers the two things this migration changes: the set_tag_colour RPC (who
-- may call it, that it writes only the colour column) and the
-- tags_colour_hex_format CHECK constraint (the column can only hold hex or
-- null). The rename guarantee is re-asserted here on purpose: the whole reason
-- recolouring is an RPC is that loosening the UPDATE policy would also have
-- opened renames to CAMs — so every suite run must prove it didn't.
--
-- The harness below is a deliberate copy of bulk_status_rpc.test.sql's rather
-- than an import: pg_prove runs each file in its own session and transaction,
-- so there is nothing to import from — and a shared harness would couple two
-- suites that are meant to fail independently.
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
create or replace function tests.set_colour_as(p_user_id uuid, p_tag uuid, p_colour text)
returns jsonb language plpgsql as $$
declare v_result jsonb;
begin
  perform tests.login_as(p_user_id);
  select public.set_tag_colour(p_tag, p_colour) into v_result;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- One admin, one active CAM, one viewer, one deactivated account, one tag.

create or replace function tests.seed_colours()
returns void language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam         uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer      uuid := '00000000-0000-4000-a000-000000000005';
  v_deactivated uuid := '00000000-0000-4000-a000-000000000004';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@180dc.org'),
    (v_cam,         '00000000-0000-4000-a000-000000000002', 'authenticated', 'authenticated', 'cam-a@180dc.org'),
    (v_viewer,      '00000000-0000-4000-a000-000000000005', 'authenticated', 'authenticated', 'viewer@180dc.org'),
    (v_deactivated, '00000000-0000-4000-a000-000000000004', 'authenticated', 'authenticated', 'gone@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin,       'admin@180dc.org',  'Test Admin',       'admin',  true),
    (v_cam,         'cam-a@180dc.org',  'Test CAM A',       'cam',    true),
    (v_viewer,      'viewer@180dc.org', 'Test Viewer',      'viewer', true),
    (v_deactivated, 'gone@180dc.org',   'Deactivated User', 'cam',    false)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name;

  -- Created by the fixed placeholder convention F188's follow-up introduced,
  -- so the fixture never depends on which user id created it.
  insert into public.tags (id, name, created_by_user_id)
  values ('00000000-0000-4000-e000-000000000001', 'Priority', v_cam)
  on conflict (id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_tag_colour()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam         uuid := '00000000-0000-4000-a000-000000000002';
  v_viewer      uuid := '00000000-0000-4000-a000-000000000005';
  v_deactivated uuid := '00000000-0000-4000-a000-000000000004';
  v_tag         uuid := '00000000-0000-4000-e000-000000000001';
  v_missing     uuid := '00000000-0000-4000-e000-0000000000ff';
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if to_regprocedure('public.set_tag_colour(uuid, text)') is null then
    return next skip(1, 'set_tag_colour not yet migrated');
    return;
  end if;

  perform tests.seed_colours();

  -- AC3: any CAM can recolour — no ownership rule on shared tags.
  return next is(
    tests.set_colour_as(v_cam, v_tag, '#175CD3'),
    jsonb_build_object('id', v_tag, 'name', 'Priority', 'colour', '#175cd3'),
    'a CAM sets a colour; it is normalised to lowercase'
  );

  return next is(
    (select colour from public.tags where id = v_tag),
    '#175cd3',
    'the row now carries the chosen colour'
  );

  return next is(
    (select name from public.tags where id = v_tag),
    'Priority',
    'recolouring left the name alone'
  );

  -- Clearing is setting null, and is its own successful outcome.
  return next is(
    tests.set_colour_as(v_admin, v_tag, null),
    jsonb_build_object('id', v_tag, 'name', 'Priority', 'colour', null),
    'passing null clears the colour'
  );

  return next is(
    (select colour from public.tags where id = v_tag),
    null,
    'the row is back to uncoloured'
  );

  -- Bad input, refused before the table is touched.
  return next is(
    tests.sqlstate_of(v_cam,
      format('select public.set_tag_colour(%L, ''red'')', v_tag)),
    '22023',
    'a non-hex colour is refused as bad input'
  );

  return next is(
    tests.sqlstate_of(v_cam,
      format('select public.set_tag_colour(%L, ''#175cd''::text)', v_tag)),
    '22023',
    'a truncated hex value is refused too'
  );

  return next is(
    (select colour from public.tags where id = v_tag),
    null,
    'the refused calls changed nothing'
  );

  return next is(
    tests.sqlstate_of(v_cam,
      format('select public.set_tag_colour(%L, ''#067647'')', v_missing)),
    'P0002',
    'recolouring a tag that does not exist fails'
  );

  -- Who may call it.
  return next is(
    tests.sqlstate_of(v_viewer,
      format('select public.set_tag_colour(%L, ''#067647'')', v_tag)),
    '42501',
    'a viewer cannot recolour — tags are write-only to contributors'
  );

  return next is(
    tests.sqlstate_of(v_deactivated,
      format('select public.set_tag_colour(%L, ''#067647'')', v_tag)),
    '42501',
    'a deactivated account cannot recolour, even holding a valid token'
  );

  -- The property the RPC design exists to protect: the direct UPDATE path
  -- stays admin-only (F189), so a crafted CAM request cannot rename OR write
  -- the column around the RPC's checks.
  return next is(
    tests.sqlstate_of(v_cam,
      format('update public.tags set colour = ''#067647'' where id = %L', v_tag)),
    '42501',
    'a CAM cannot UPDATE the column directly — recolouring goes through the RPC only'
  );

  return next is(
    tests.sqlstate_of(v_cam,
      format('update public.tags set name = ''Renamed'' where id = %L', v_tag)),
    '42501',
    'a CAM still cannot RENAME — widening colour did not widen name (F189)'
  );

  return next is(
    tests.sqlstate_of(v_admin,
      format('update public.tags set name = ''Priorities'' where id = %L', v_tag)),
    null,
    'an admin keeps renaming through the unchanged policy'
  );

  -- The CHECK constraint, independent of the RPC.
  return next is(
    tests.sqlstate_of(v_admin,
      format('update public.tags set colour = ''not-a-colour'' where id = %L', v_tag)),
    '23514',
    'the constraint refuses non-hex even from an admin'
  );

  return next ok(
    has_function_privilege('authenticated',
      'public.set_tag_colour(uuid, text)', 'execute'),
    'authenticated may call the RPC — the body decides who succeeds'
  );

  return next ok(
    not has_function_privilege('anon',
      'public.set_tag_colour(uuid, text)', 'execute'),
    'anon may not call the RPC at all'
  );
end;
$$;

select tests.suite_tag_colour();

select * from finish();
rollback;
