-- verify_own_password RPC tests (20261004100000). Run by `supabase test db`.
--
-- Runs as real end-user roles, never as service_role or the owning role: the
-- RPC is SECURITY DEFINER, so testing it as a superuser would exercise a code
-- path no user can reach.

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

create or replace function tests.verify_as(p_user_id uuid, p_password text)
returns boolean language plpgsql as $$
declare v_result boolean;
begin
  perform tests.login_as(p_user_id);
  v_result := public.verify_own_password(p_password);
  perform tests.logout();
  return v_result;
end;
$$;

create or replace function tests.verify_sqlstate(p_user_id uuid, p_password text)
returns text language plpgsql as $$
declare v_state text;
begin
  if p_user_id is not null then
    perform tests.login_as(p_user_id);
  end if;
  begin
    perform public.verify_own_password(p_password);
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  perform tests.logout();
  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: two active CAMs with different passwords, one deactivated CAM.
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('00000000-0000-4000-a000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pw-a@180dc.org',
    extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf'))),
  ('00000000-0000-4000-a000-000000000202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pw-b@180dc.org',
    extensions.crypt('Battery-Staple-2', extensions.gen_salt('bf'))),
  ('00000000-0000-4000-a000-000000000203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pw-off@180dc.org',
    extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')))
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, is_active)
values
  ('00000000-0000-4000-a000-000000000201', 'pw-a@180dc.org',   'PW CAM A',   'cam', true),
  ('00000000-0000-4000-a000-000000000202', 'pw-b@180dc.org',   'PW CAM B',   'cam', true),
  ('00000000-0000-4000-a000-000000000203', 'pw-off@180dc.org', 'PW CAM Off', 'cam', false)
on conflict (id) do update
  set role = excluded.role,
      is_active = excluded.is_active,
      full_name = excluded.full_name;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

select ok(
  tests.verify_as('00000000-0000-4000-a000-000000000201', 'Correct-Horse-1'),
  'the caller''s own current password verifies'
);

select ok(
  not tests.verify_as('00000000-0000-4000-a000-000000000201', 'correct-horse-1'),
  'a wrong password does not verify'
);

select ok(
  not tests.verify_as('00000000-0000-4000-a000-000000000201', 'Battery-Staple-2'),
  'another user''s password does not verify against the caller''s hash'
);

select ok(
  not tests.verify_as('00000000-0000-4000-a000-000000000201', ''),
  'an empty password does not verify'
);

select is(
  tests.verify_sqlstate('00000000-0000-4000-a000-000000000203', 'Correct-Horse-1'),
  '42501',
  'a deactivated user is refused even with the right password'
);

select is(
  tests.verify_sqlstate(null, 'Correct-Horse-1'),
  '42501',
  'a call with no session is refused'
);

select ok(
  not has_function_privilege('anon', 'public.verify_own_password(text)', 'execute'),
  'anon cannot execute verify_own_password'
);

select ok(
  has_function_privilege('authenticated', 'public.verify_own_password(text)', 'execute'),
  'authenticated can execute verify_own_password'
);

select * from finish();

rollback;
