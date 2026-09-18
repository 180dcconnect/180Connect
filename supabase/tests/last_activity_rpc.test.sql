-- Last-activity aggregation RPC behaviour tests — F160 (#155).
-- Spec: issue #155 acceptance criteria; docs/rls-permission-matrix.md §3.4.
-- Run by `supabase test db`.
--
-- Covers public.get_clients_last_activity — the per-client activity clock the
-- follow-up recommendations measure silence against. Worth a database test:
-- each source's max actually wins (an older email under a newer reply, an audit
-- row newer than both), clients with no activity return nulls rather than rows
-- being dropped, a CAM's request for a client they do not own is silently
-- dropped (the documented shape) while an admin gets it, and inactive accounts
-- are refused outright.

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

create or replace function tests.sqlstate_as(p_user_id uuid, p_sql text)
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

create or replace function tests.rows_for(p_user_id uuid, p_ids uuid[])
returns table (organisation_id uuid, last_email_sent_at timestamptz, last_reply_received_at timestamptz, last_status_change_at timestamptz)
language plpgsql as $$
begin
  perform tests.login_as(p_user_id);
  return query
  select * from public.get_clients_last_activity(p_ids)
  order by organisation_id;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end;
$$;

create or replace function tests.seed_activity()
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
    (v_cam_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b@180dc.org'),
    ('00000000-0000-4000-a000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'offboarded@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin, 'admin@180dc.org', 'Test Admin', 'admin', true),
    (v_cam_a, 'cam-a@180dc.org', 'Test CAM A', 'cam',   true),
    (v_cam_b, 'cam-b@180dc.org', 'Test CAM B', 'cam',   true),
    ('00000000-0000-4000-a000-000000000004', 'offboarded@180dc.org', 'Offboarded CAM', 'cam', false)
  on conflict (id) do update
    set role = excluded.role, is_active = excluded.is_active;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    ('00000000-0000-4000-c000-000000000101', 'Busy Client',     'manual', 'other', v_cam_a),
    ('00000000-0000-4000-c000-000000000102', 'Silent Client',   'manual', 'other', v_cam_a),
    ('00000000-0000-4000-c000-000000000103', 'CAM B Client',    'manual', 'other', v_cam_b);

  -- Busy Client: three sources at deliberately different ages — the reply is the
  -- newest overall, the status change sits between, the email is oldest.
  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, sent_at)
  values
    ('00000000-0000-4000-d000-000000000201', '00000000-0000-4000-c000-000000000101', v_cam_a, 'First',  'Body', 'sent', '2026-09-01T09:00:00Z'),
    ('00000000-0000-4000-d000-000000000202', '00000000-0000-4000-c000-000000000101', v_cam_a, 'Second', 'Body', 'sent', '2026-09-05T09:00:00Z'),
    -- A draft must never count as activity: nothing was sent.
    ('00000000-0000-4000-d000-000000000203', '00000000-0000-4000-c000-000000000102', v_cam_a, 'Draft',  'Body', 'draft', null);

  insert into public.reply_events (id, reply_body, received_at, organisation_id)
  values ('00000000-0000-4000-e000-000000000201', 'Thanks!', '2026-09-10T09:00:00Z', '00000000-0000-4000-c000-000000000101');

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail, created_at)
  values (v_cam_a, 'status_changed', 'organisations', '00000000-0000-4000-c000-000000000101',
          '{"from":"not_contacted","to":"initial_outreach_sent"}', '2026-09-07T09:00:00Z');
end;
$$;

create or replace function tests.suite_last_activity()
returns setof text language plpgsql as $$
declare
  v_admin  uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a  uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b  uuid := '00000000-0000-4000-a000-000000000003';
  v_busy   uuid := '00000000-0000-4000-c000-000000000101';
  v_silent uuid := '00000000-0000-4000-c000-000000000102';
  v_other  uuid := '00000000-0000-4000-c000-000000000103';
begin
  if to_regprocedure('public.get_clients_last_activity(uuid[])') is null then
    return next skip(1, 'get_clients_last_activity not yet migrated');
    return;
  end if;

  perform tests.seed_activity();

  -- The clock per source: max of each, independently proven.
  return next is(
    (select last_email_sent_at from tests.rows_for(v_cam_a, array[v_busy])),
    '2026-09-05T09:00:00Z'::timestamptz,
    'last_email_sent_at is the newest SENT message, drafts never count'
  );
  return next is(
    (select last_reply_received_at from tests.rows_for(v_cam_a, array[v_busy])),
    '2026-09-10T09:00:00Z'::timestamptz,
    'last_reply_received_at is the newest reply'
  );
  return next is(
    (select last_status_change_at from tests.rows_for(v_cam_a, array[v_busy])),
    '2026-09-07T09:00:00Z'::timestamptz,
    'last_status_change_at is the newest audited pipeline transition'
  );

  -- A silent client still returns its row — with nulls, so the caller can tell
  -- "no activity" apart from "not visible".
  return next ok(
    (select last_email_sent_at is null and last_reply_received_at is null and last_status_change_at is null
       from tests.rows_for(v_cam_a, array[v_silent])),
    'a client with no recorded activity comes back all-null, not missing'
  );

  -- Ownership line: a CAM asking for someone else's client gets that id dropped,
  -- silently — the documented contract.
  return next is(
    (select count(*) from tests.rows_for(v_cam_a, array[v_busy, v_other])),
    1::bigint,
    'a CAM''s batch keeps only the clients they own'
  );
  return next is(
    (select count(*) from tests.rows_for(v_cam_b, array[v_busy])),
    0::bigint,
    'another CAM sees none of this CAM''s clients'
  );

  -- Admins read across ownership, same as everywhere else in §3.4.
  return next is(
    (select count(*) from tests.rows_for(v_admin, array[v_busy, v_other])),
    2::bigint,
    'an admin gets every requested client'
  );

  -- An offboarded (is_active = false) account is refused before any data
  -- leaves — the definer body's own app.is_active_user() re-check, not just
  -- the grant.
  return next is(
    tests.sqlstate_as('00000000-0000-4000-a000-000000000004'::uuid, format(
      'select * from public.get_clients_last_activity(array[%L]::uuid[])', v_busy)),
    '42501',
    'an inactive account is refused outright'
  );

  -- ...while an active account succeeds through the ordinary path.
  return next is(
    tests.sqlstate_as(v_cam_b, format(
      'select * from public.get_clients_last_activity(array[%L]::uuid[])', v_other)),
    null,
    'an active user can execute the RPC through the ordinary path'
  );
end;
$$;

select * from tests.suite_last_activity();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();

rollback;
