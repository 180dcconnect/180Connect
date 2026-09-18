-- Send-failure-handling RPC behaviour tests — F129 (#124).
-- Spec: docs/audit-log-pattern.md. Run by `supabase test db`.
--
-- Covers public.mark_outreach_send_failed and public.reopen_outreach_draft —
-- the scheduled→failed flip the cron worker records and the failed→draft
-- recovery the CAM's retry action uses. The things worth a database test:
-- EXECUTE on the failure RPC belongs to service_role alone; the flip is
-- conditional on send_status='scheduled' so a raced cancel wins; the
-- SEND_EVENTS 'failed' row and audit_log entry land atomically; reopening
-- draws the admin-or-sender line inside the definer body; and both
-- transitions are audited.
--
-- Harness deliberately copied from scheduled_outreach_rpc.test.sql (pg_prove
-- runs each file in its own session and transaction); runs as real end-user
-- roles, never service_role or the owning role.

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

create or replace function tests.result_as(p_user_id uuid, p_sql text)
returns text language plpgsql as $$
declare v_result text;
begin
  perform tests.login_as(p_user_id);
  begin
    execute p_sql into v_result;
  exception when others then
    v_result := null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function tests.seed_failure()
returns void language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000031';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000032';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000033';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-f@180dc.org'),
    (v_cam_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a-f@180dc.org'),
    (v_cam_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b-f@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin, 'admin-f@180dc.org', 'Test Admin F', 'admin', true),
    (v_cam_a, 'cam-a-f@180dc.org', 'Test CAM A F', 'cam',   true),
    (v_cam_b, 'cam-b-f@180dc.org', 'Test CAM B F', 'cam',   true)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    ('00000000-0000-4000-c000-000000000031', 'F CAM A Client', 'manual', 'other', v_cam_a),
    ('00000000-0000-4000-c000-000000000032', 'F CAM B Client', 'manual', 'other', v_cam_b);

  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, scheduled_at, send_claimed_at)
  values
    -- The worker's target: due, claimed mid-delivery, Gmail said no.
    ('00000000-0000-4000-d000-000000000031', '00000000-0000-4000-c000-000000000031', v_cam_a, 'Failed soon F', 'Body', 'scheduled', now() - interval '1 hour', now()),
    -- Wrong-state guards.
    ('00000000-0000-4000-d000-000000000032', '00000000-0000-4000-c000-000000000031', v_cam_a, 'Still draft F', 'Body', 'draft', null, null),
    ('00000000-0000-4000-d000-000000000033', '00000000-0000-4000-c000-000000000031', v_cam_a, 'Already failed F', 'Body', 'failed', null, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_send_failure_handling()
returns setof text language plpgsql as $$
declare
  v_admin  uuid := '00000000-0000-4000-a000-000000000031';
  v_cam_a  uuid := '00000000-0000-4000-a000-000000000032';
  v_cam_b  uuid := '00000000-0000-4000-a000-000000000033';
  v_scheduled uuid := '00000000-0000-4000-d000-000000000031';
  v_draft     uuid := '00000000-0000-4000-d000-000000000032';
  v_failed    uuid := '00000000-0000-4000-d000-000000000033';
  v_state text;
  v_result text;
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if to_regprocedure('public.mark_outreach_send_failed(uuid,text)') is null
     or to_regprocedure('public.reopen_outreach_draft(uuid)') is null then
    return next skip(1, 'send-failure RPCs not yet migrated');
    return;
  end if;

  perform tests.seed_failure();

  -- The enum value itself exists.
  return next ok(
    exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'send_event_type' and e.enumlabel = 'failed'
    ),
    'send_event_type carries a ''failed'' label'
  );

  -- -----------------------------------------------------------------------
  -- mark_outreach_send_failed: authorisation model is the grant itself.
  -- -----------------------------------------------------------------------

  select * into v_state, v_result from tests.run_as(
    'authenticated',
    format('select public.mark_outreach_send_failed(%L, ''Gmail down'')', v_scheduled)
  );
  return next is(v_state, '42501',
    'EXECUTE refused to plain authenticated users — service_role-only grant holds');

  return next is(
    (select count(*) from public.send_events where outreach_message_id = v_scheduled),
    0::bigint,
    'the refused attempt wrote nothing'
  );

  -- Empty reason refused (22004), matching create_notification's convention.
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select public.mark_outreach_send_failed(%L, ''   '')', v_scheduled)
  );
  return next is(v_state, '22004', 'an empty failure reason is refused');

  -- Wrong state: a draft cannot be "failed" — returns false, writes nothing.
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select public.mark_outreach_send_failed(%L, ''Gmail down'')', v_draft)
  );
  return next is(v_state, null, 'a non-scheduled message does not raise');
  return next is(v_result, 'false', 'a non-scheduled message is reported as not-failed');

  -- The real transition: scheduled→failed with event + audit, atomically.
  select * into v_state, v_result from tests.run_as(
    'service_role',
    format('select public.mark_outreach_send_failed(%L, %L)', v_scheduled,
           'Gmail is temporarily unavailable. Try again.')
  );
  return next is(v_state, null, 'the worker''s failure flip succeeds');
  return next is(v_result, 'true', 'the worker''s failure flip reports success');

  return next is(
    (select send_status from public.outreach_messages where id = v_scheduled),
    'failed',
    'the message is failed — no silent cron retry loop'
  );

  return next is(
    (select send_claimed_at from public.outreach_messages where id = v_scheduled),
    null,
    'the stale delivery claim is released with the flip'
  );

  return next is(
    (select metadata->>'reason' from public.send_events
      where outreach_message_id = v_scheduled and event_type = 'failed'),
    'Gmail is temporarily unavailable. Try again.',
    'F129 AC2: the SEND_EVENTS failed row carries the transport''s reason'
  );

  return next is(
    (select count(*) from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_scheduled
        and action = 'outreach_send_failed'),
    1::bigint,
    'the status change lands its audit_log row in the same transaction'
  );

  -- -----------------------------------------------------------------------
  -- reopen_outreach_draft: the CAM-side recovery path.
  -- -----------------------------------------------------------------------

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.reopen_outreach_draft(%L)', v_scheduled)
    ),
    '42501',
    'another CAM reopening someone else''s failed email is refused'
  );

  return next is(
    (select send_status from public.outreach_messages where id = v_scheduled),
    'failed',
    'the refused reopen changed nothing'
  );

  -- Sender can reopen; audited against them.
  return next is(
    tests.result_as(v_cam_a, format('select public.reopen_outreach_draft(%L)::text', v_scheduled)),
    'true',
    'the sender reopens their own failed email'
  );

  return next is(
    (select send_status from public.outreach_messages where id = v_scheduled),
    'draft',
    'reopened back to draft — retry flows through the ordinary reviewed send path (AC3)'
  );

  return next is(
    (select count(*) from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_scheduled
        and action = 'outreach_send_reopened'
        and actor_user_id = v_cam_a),
    1::bigint,
    'the recovery transition is audited against its actor'
  );

  -- Admin may reopen someone else's.
  return next is(
    tests.result_as(v_admin, format('select public.reopen_outreach_draft(%L)::text', v_failed)),
    'true',
    'an admin can reopen any failed email'
  );

  return next is(
    (select send_status from public.outreach_messages where id = v_failed),
    'draft',
    'the admin''s reopen landed'
  );

  -- Already-reopened: second call matches zero rows, reports false.
  return next is(
    tests.result_as(v_cam_a, format('select public.reopen_outreach_draft(%L)::text', v_scheduled)),
    'false',
    'reopening an email that is no longer failed reports not-failed'
  );
end;
$$;

select * from tests.suite_send_failure_handling();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();

rollback;
