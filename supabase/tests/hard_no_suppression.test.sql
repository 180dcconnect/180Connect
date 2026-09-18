-- Hard No → suppression request tests — F153 (#148) AC2
-- Spec: 20260904090000_hard_no_files_suppression_request.sql. Run by `supabase test db`.
--
-- The property worth a database test: moving a client to hard_no files exactly one
-- PENDING suppression request (the admin still decides, per F251), attributed to the
-- actor, audited, and never duplicated — while every other transition files nothing
-- and seed rows are left alone.
--
-- Harness is a deliberate copy of bulk_status_rpc.test.sql's (pg_prove runs each
-- file in its own session; nothing to import). Everything rolls back.

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
    true
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

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function tests.seed_hardno()
returns void language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_cam   uuid := '00000000-0000-4000-a000-000000000002';
  v_other uuid := '00000000-0000-4000-a000-000000000003';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@180dc.org'),
    (v_cam,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam@180dc.org'),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin, 'admin@180dc.org', 'Test Admin', 'admin', true),
    (v_cam,   'cam@180dc.org',   'Test CAM',   'cam',   true),
    (v_other, 'other@180dc.org', 'Other CAM',  'cam',   true)
  on conflict (id) do update
    set role = excluded.role, is_active = excluded.is_active;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values
    ('00000000-0000-4000-c000-000000000001', 'Hard No Target',     'manual', 'other', v_cam,   'not_contacted'),
    ('00000000-0000-4000-c000-000000000002', 'Soft No Control',    'manual', 'other', v_cam,   'not_contacted'),
    ('00000000-0000-4000-c000-000000000003', 'Already Suppressed', 'manual', 'other', v_cam,   'not_contacted'),
    ('00000000-0000-4000-c000-000000000004', 'Seed Org',           'manual', 'other', v_cam,   'not_contacted');

  update public.organisations set is_seed = true where id = '00000000-0000-4000-c000-000000000004';

  -- One already-active suppression behind the third client: the "open request
  -- exists" guard must skip filing without failing the status change.
  insert into public.suppressions (organisation_id, status, reason, requested_by, decided_by, decided_at)
    values ('00000000-0000-4000-c000-000000000003', 'active', 'Existing DNC.', v_cam, v_admin, now());
end;
$$;

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------

select tests.seed_hardno();

-- AC2: the single-client path files a pending request attributed to the CAM…
select tests.login_as('00000000-0000-4000-a000-000000000002');
select public.set_outreach_status(
  '00000000-0000-4000-c000-000000000001'::uuid,
  'hard_no'::public.outreach_status
);
reset role;
select set_config('request.jwt.claims', null, true);

select is(
  (select status from public.suppressions where organisation_id = '00000000-0000-4000-c000-000000000001'),
  'pending',
  'hard_no via set_outreach_status lands as pending — admin still decides (F251)'
);

select is(
  (select requested_by from public.suppressions where organisation_id = '00000000-0000-4000-c000-000000000001'),
  '00000000-0000-4000-a000-000000000002',
  'the request is attributed to the CAM who made the status change'
);

select is(
  (select decided_by is null from public.suppressions where organisation_id = '00000000-0000-4000-c000-000000000001'),
  true,
  'pending row carries no decision yet'
);

-- …and the filing is audited inside the same transaction.
select is(
  (select count(*) from public.audit_log
    where action = 'suppression_requested'
      and target_id = '00000000-0000-4000-c000-000000000001'
      and detail ->> 'trigger' = 'hard_no_status'),
  1::bigint,
  'one suppression_requested audit row with the hard_no trigger marker'
);

-- Only hard_no fires. Soft No stays outside DNC by design (F152 AC2).
select tests.login_as('00000000-0000-4000-a000-000000000002');
select public.set_outreach_status(
  '00000000-0000-4000-c000-000000000002'::uuid,
  'soft_no'::public.outreach_status
);
reset role;
select set_config('request.jwt.claims', null, true);

select is(
  (select count(*) from public.suppressions where organisation_id = '00000000-0000-4000-c000-000000000002'),
  0::bigint,
  'soft_no files no suppression request'
);

-- An organisation that already has an OPEN suppression gets no second row, and the
-- status change itself still succeeds (the unique index would otherwise 23505 it).
select tests.login_as('00000000-0000-4000-a000-000000000002');
select public.set_outreach_status(
  '00000000-0000-4000-c000-000000000003'::uuid,
  'hard_no'::public.outreach_status
);
reset role;
select set_config('request.jwt.claims', null, true);

select is(
  (select outreach_status::text from public.organisations where id = '00000000-0000-4000-c000-000000000003'),
  'hard_no',
  'hard_no succeeds on an organisation with an open suppression'
);

select is(
  (select count(*) from public.suppressions where organisation_id = '00000000-0000-4000-c000-000000000003'),
  1::bigint,
  'no duplicate request when one is already open'
);

-- Seed fixtures must cycle statuses without piling up requests.
update public.organisations
   set outreach_status = 'hard_no'
 where id = '00000000-0000-4000-c000-000000000004';

select is(
  (select count(*) from public.suppressions where organisation_id = '00000000-0000-4000-c000-000000000004'),
  0::bigint,
  'is_seed rows file nothing'
);

-- A no-op write (already hard_no) re-fires nothing; and the bulk path files one
-- request per moved client.
select tests.login_as('00000000-0000-4000-a000-000000000002');
select public.set_outreach_status(
  '00000000-0000-4000-c000-000000000001'::uuid,
  'hard_no'::public.outreach_status
);
select public.set_outreach_status_bulk(
  array['00000000-0000-4000-c000-000000000002']::uuid[],
  'hard_no'::public.outreach_status
);
reset role;
select set_config('request.jwt.claims', null, true);

select is(
  (select count(*) from public.suppressions where organisation_id = '00000000-0000-4000-c000-000000000001'),
  1::bigint,
  're-setting hard_no on an already-hard-no client files nothing new'
);

select is(
  (select status from public.suppressions where organisation_id = '00000000-0000-4000-c000-000000000002'),
  'pending',
  'the bulk path files the same pending request as the single path'
);

-- A non-owner CAM cannot use hard_no to reach the trigger at all: the RPC refuses
-- the status change before any row moves, so no request is filed either.
select is(
  tests.sqlstate_of(
    '00000000-0000-4000-a000-000000000003',
    'select public.set_outreach_status(''00000000-0000-4000-c000-000000000001''::uuid, ''hard_no''::public.outreach_status)'
  ),
  '42501',
  'a CAM who does not own the client cannot change its status to hard_no'
);

select is(
  (select count(*) from public.audit_log
    where action = 'suppression_requested'
      and target_id = '00000000-0000-4000-c000-000000000001'),
  1::bigint,
  'the refused call filed nothing new — still only the original request row'
);

select * from finish();
rollback;
