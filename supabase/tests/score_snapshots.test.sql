-- Score snapshot tests — F097 (#96)
-- Spec: 20260911120000_create_score_snapshots.sql. Run by `supabase test db`.
--
-- The property worth a database test rather than a unit test: the training row
-- commits or rolls back WITH the send recordal — a malformed vector refuses the
-- whole send (never half-recorded), a valid one lands exactly once, and the
-- table is admin-readable only. Harness copied from send_reviewed_rpc.test.sql.

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

create or replace function tests.bool_as(p_user_id uuid, p_sql text)
returns boolean language plpgsql as $$
declare v_result boolean;
begin
  perform tests.login_as(p_user_id);
  execute p_sql into v_result;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_result;
end;
$$;

create or replace function tests.uuid_as(p_user_id uuid, p_sql text)
returns uuid language plpgsql as $$
declare v_result uuid;
begin
  perform tests.login_as(p_user_id);
  execute p_sql into v_result;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_result;
end;
$$;

create or replace function tests.bool_as_service(p_sql text)
returns boolean language plpgsql as $$
declare v_result boolean;
begin
  -- auth.uid() must be NULL in here (the worker runs as service_role); switching
  -- to that role with no JWT claims set achieves exactly the RPC's guard state.
  execute 'set local role service_role';
  execute p_sql into v_result;
  execute 'reset role';
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: one CAM-owned client with two drafts, one second CAM, one admin.
-- ---------------------------------------------------------------------------

create or replace function tests.seed_snapshots()
returns void language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000003';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@180dc.org'),
    (v_cam_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a@180dc.org'),
    (v_cam_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin, 'admin@180dc.org', 'Test Admin', 'admin', true),
    (v_cam_a, 'cam-a@180dc.org', 'Test CAM A', 'cam',   true),
    (v_cam_b, 'cam-b@180dc.org', 'Test CAM B', 'cam',   true)
  on conflict (id) do update
    set role = excluded.role, is_active = excluded.is_active;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values
    ('00000000-0000-4000-c000-000000000001', 'Snapshot Client', 'manual', 'other', v_cam_a, 'not_contacted');

  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, sent_at)
  values
    ('00000000-0000-4000-d000-000000000101', '00000000-0000-4000-c000-000000000001', v_cam_a, 'First',  'Body', 'draft', null),
    ('00000000-0000-4000-d000-000000000102', '00000000-0000-4000-c000-000000000001', v_cam_a, 'Second', 'Body', 'draft', null),
    ('00000000-0000-4000-d000-000000000103', '00000000-0000-4000-c000-000000000001', v_cam_a, 'Third',  'Body', 'draft', null);
end;
$$;

-- A well-formed vector reused across cases.
create or replace function tests.good_snapshot()
returns jsonb language sql as $$
  select jsonb_build_object(
    'sector', 0.5,
    'geography', 1,
    'size', 0.25,
    'partnership_history', 0,
    'previous_contact', 0.8,
    'priority_score', 0.51,
    'priority_band', 'medium',
    'model_version_id', null
  );
$$;

select tests.seed_snapshots();

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------

-- AC1: the recorded send carries its point-in-time vector — same transaction.
select is(
  tests.uuid_as(
    '00000000-0000-4000-a000-000000000002',
    format(
      'select public.mark_outreach_sent(''00000000-0000-4000-d000-000000000101''::uuid, ''pm'', ''pt'', ''client@example.org'', %L)',
      tests.good_snapshot()::text
    )
  ),
  '00000000-0000-4000-d000-000000000101',
  'the send records successfully with a valid snapshot'
);

select is(
  (select sector from public.score_snapshots where outreach_message_id = '00000000-0000-4000-d000-000000000101'),
  0.5::double precision,
  'snapshot factor stored verbatim'
);

select is(
  (select previous_contact from public.score_snapshots where outreach_message_id = '00000000-0000-4000-d000-000000000101'),
  0.8::double precision,
  'previous_contact stored verbatim'
);

select is(
  (select priority_score from public.score_snapshots where outreach_message_id = '00000000-0000-4000-d000-000000000101'),
  0.51::double precision,
  'priority_score stored verbatim'
);

select is(
  (select priority_band from public.score_snapshots where outreach_message_id = '00000000-0000-4000-d000-000000000101'),
  'medium',
  'priority_band stored verbatim'
);

select is(
  (select count(*) from public.score_snapshots),
  1::bigint,
  'exactly one snapshot row so far'
);

-- Admin-only reads: RLS filters SELECTs silently rather than raising — a CAM
-- sees an empty table, an admin sees the row.
select is(
  tests.sqlstate_of(
    '00000000-0000-4000-a000-000000000002',
    'select count(*) from public.score_snapshots'
  ),
  null,
  'a CAM can attempt the read without error'
);

select is(
  tests.bool_as(
    '00000000-0000-4000-a000-000000000002',
    'select (select count(*) from public.score_snapshots) = 0'
  ),
  true,
  'the CAM''s view of score snapshots is empty (admin-only, like model_versions)'
);

select is(
  tests.sqlstate_of(
    '00000000-0000-4000-a000-000000000001',
    'select count(*) from public.score_snapshots'
  ),
  null,
  'an admin can read score snapshots'
);

-- A malformed factor refuses the WHOLE recordal: no sent flip, no pipeline
-- advance, no partial row. Poison must never enter the training set quietly.
select is(
  tests.sqlstate_of(
    '00000000-0000-4000-a000-000000000002',
    format(
      'select public.mark_outreach_sent(''00000000-0000-4000-d000-000000000102''::uuid, ''pm'', ''pt'', ''client@example.org'', %L)',
      '{"sector":1.5,"geography":0.5,"size":0.5,"partnership_history":0,"previous_contact":0,"priority_score":0.5,"priority_band":"medium"}'::text
    )
  ),
  '22023',
  'an out-of-range factor raises instead of storing junk'
);

select is(
  (select send_status::text || '|' || outreach_status::text
     from public.outreach_messages m
     join public.organisations o on o.id = m.organisation_id
    where m.id = '00000000-0000-4000-d000-000000000102'),
  'draft|initial_outreach_sent',
  'the refused recordal left the message unsent — pipeline unchanged from the earlier valid send'
);

select is(
  tests.sqlstate_of(
    '00000000-0000-4000-a000-000000000002',
    format(
      'select public.mark_outreach_sent(''00000000-0000-4000-d000-000000000103''::uuid, ''pm'', ''pt'', ''client@example.org'', %L)',
      '{"sector":0.5,"geography":0.5,"size":0.5,"partnership_history":0,"previous_contact":0,"priority_score":0.5,"priority_band":"maybe"}'::text
    )
  ),
  '22023',
  'an unknown band raises'
);

-- Null snapshot: the send stands alone (caller could not build one — logged
-- app-side). Visible gap in the training set, never a fabricated row.
select is(
  tests.uuid_as(
    '00000000-0000-4000-a000-000000000002',
    'select public.mark_outreach_sent(''00000000-0000-4000-d000-000000000102''::uuid, ''pm2'', ''pt2'', ''client@example.org'', null)'
  ),
  '00000000-0000-4000-d000-000000000102',
  'a null snapshot still records the send'
);

select is(
  (select count(*) from public.score_snapshots where outreach_message_id = '00000000-0000-4000-d000-000000000102'),
  0::bigint,
  'no snapshot row for the null case'
);

-- Uniqueness per message: the double-record refusal fires before any second
-- insert could be attempted anyway; assert the count stayed at one message.
select is(
  tests.sqlstate_of(
    '00000000-0000-4000-a000-000000000002',
    format(
      'select public.mark_outreach_sent(''00000000-0000-4000-d000-000000000101''::uuid, ''pm'', ''pt'', ''client@example.org'', %L)',
      tests.good_snapshot()::text
    )
  ),
  'P0002',
  're-recording a sent email raises'
);

select is(
  (select count(*) from public.score_snapshots),
  1::bigint,
  'still exactly one snapshot after the refused double-record'
);

-- Scheduled path parity: service-role worker records delivery + snapshot in
-- one transaction. Fixture: a claimed scheduled message.
update public.outreach_messages
   set send_status = 'scheduled',
       scheduled_at = now() - interval '1 hour',
       send_claimed_at = '2026-09-11T12:00:00Z'
 where id = '00000000-0000-4000-d000-000000000103';

select is(
  tests.bool_as_service(format(
    'select public.mark_scheduled_outreach_delivered(''00000000-0000-4000-d000-000000000103''::uuid, ''pm3'', ''pt3'', ''2026-09-11T12:00:00Z''::timestamptz, %L)',
    tests.good_snapshot()::text
  )),
  true,
  'the cron worker records its delivery through the claim-pinned RPC'
);

select is(
  (select priority_band from public.score_snapshots where outreach_message_id = '00000000-0000-4000-d000-000000000103'),
  'medium',
  'the scheduled path filed its snapshot in the same transaction'
);

select * from finish();
rollback;
