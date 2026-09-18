-- Scheduled-outreach RPC behaviour tests — F126 (#122).
-- Spec: docs/audit-log-pattern.md. Run by `supabase test db`.
--
-- Covers public.schedule_outreach_send and public.cancel_outreach_schedule —
-- the two RPCs behind "Schedule reviewed email" / "Cancel schedule". The things
-- worth a database test: a non-owner's attempt is REFUSED (42501), not silently
-- no-oped; suppressed clients cannot gain a pending delivery; scheduling only
-- works from a draft and cancellation only from a scheduled row; cancel is
-- possible at all despite RLS pinning every direct UPDATE to drafts; and both
-- transitions land their audit_log row in the same transaction.
--
-- Harness deliberately copied from send_reviewed_rpc.test.sql (pg_prove runs
-- each file in its own session and transaction); runs as real end-user roles,
-- never service_role or the owning role.

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

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function tests.seed_schedule()
returns void language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000011';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000012';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000013';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-s@180dc.org'),
    (v_cam_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a-s@180dc.org'),
    (v_cam_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b-s@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin, 'admin-s@180dc.org', 'Test Admin S', 'admin', true),
    (v_cam_a, 'cam-a-s@180dc.org', 'Test CAM A S', 'cam',   true),
    (v_cam_b, 'cam-b-s@180dc.org', 'Test CAM B S', 'cam',   true)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    ('00000000-0000-4000-c000-000000000011', 'S CAM A Client',      'manual', 'other', v_cam_a),
    ('00000000-0000-4000-c000-000000000012', 'S CAM B Client',      'manual', 'other', v_cam_b),
    ('00000000-0000-4000-c000-000000000013', 'S Suppressed Client', 'manual', 'other', v_cam_a);

  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, sent_at, scheduled_at, send_claimed_at)
  values
    ('00000000-0000-4000-d000-000000000011', '00000000-0000-4000-c000-000000000011', v_cam_a, 'Hello S',       'Body', 'draft',     null, null, null),
    ('00000000-0000-4000-d000-000000000012', '00000000-0000-4000-c000-000000000013', v_cam_a, 'Suppressed S',  'Body', 'draft',     null, null, null),
    ('00000000-0000-4000-d000-000000000013', '00000000-0000-4000-c000-000000000011', v_cam_a, 'Scheduled S',   'Body', 'scheduled', null, now() + interval '1 hour', null),
    ('00000000-0000-4000-d000-000000000014', '00000000-0000-4000-c000-000000000011', v_cam_a, 'Already out S', 'Body', 'sent',      now(), null, null),
    -- Freshly claimed: the worker is mid-Gmail-call for it, per F123's claim column.
    ('00000000-0000-4000-d000-000000000015', '00000000-0000-4000-c000-000000000011', v_cam_a, 'In flight S',   'Body', 'scheduled', null, now() + interval '1 hour', now()),
    -- Stale claim (crashed worker): must NOT block scheduling or cancelling.
    ('00000000-0000-4000-d000-000000000016', '00000000-0000-4000-c000-000000000011', v_cam_a, 'Stale claim S', 'Body', 'scheduled', null, now() + interval '1 hour', now() - interval '10 minutes'),
    -- Freshly claimed draft: a previous manual send is still in flight.
    ('00000000-0000-4000-d000-000000000017', '00000000-0000-4000-c000-000000000011', v_cam_a, 'Claimed draft S', 'Body', 'draft', null, null, now());

  insert into public.suppressions (organisation_id, status, reason, requested_by, decided_by, decided_at)
  values ('00000000-0000-4000-c000-000000000013', 'active', 'Do not contact (test)', v_cam_a, v_admin, now())
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_scheduled_outreach()
returns setof text language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000011';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000012';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000013';
  v_draft     uuid := '00000000-0000-4000-d000-000000000011';
  v_suppressed uuid := '00000000-0000-4000-d000-000000000012';
  v_scheduled uuid := '00000000-0000-4000-d000-000000000013';
  v_already_out uuid := '00000000-0000-4000-d000-000000000014';
  v_in_flight uuid := '00000000-0000-4000-d000-000000000015';
  v_stale_claim uuid := '00000000-0000-4000-d000-000000000016';
  v_claimed_draft uuid := '00000000-0000-4000-d000-000000000017';
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if to_regprocedure('public.schedule_outreach_send(uuid,timestamptz)') is null
     or to_regprocedure('public.cancel_outreach_schedule(uuid)') is null then
    return next skip(1, 'scheduled-outreach RPCs not yet migrated');
    return;
  end if;

  perform tests.seed_schedule();

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.schedule_outreach_send(%L, now() + interval ''1 day'')', v_draft)
    ),
    '42501',
    'another CAM scheduling someone else''s draft is refused, not silently no-oped'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.cancel_outreach_schedule(%L)', v_scheduled)
    ),
    '42501',
    'another CAM cancelling someone else''s schedule is refused'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.schedule_outreach_send(%L, now() + interval ''1 day'')', v_suppressed)
    ),
    'P0001',
    'a suppressed client cannot gain a pending delivery at schedule time'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.cancel_outreach_schedule(%L)', v_draft)
    ),
    'P0002',
    'cancelling an unscheduled draft raises instead of matching zero rows'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.cancel_outreach_schedule(%L)', v_already_out)
    ),
    'P0002',
    'cancelling a sent message is impossible — sent records stay immutable'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.cancel_outreach_schedule(%L)', v_in_flight)
    ),
    'P0001',
    'cancelling while the worker holds a fresh delivery claim is refused — the email may already be leaving'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.schedule_outreach_send(%L, now() + interval ''1 day'')', v_claimed_draft)
    ),
    'P0001',
    'scheduling a draft whose fresh claim is held (manual send in flight) is refused, not raced'
  );

  return next is(
    tests.uuid_as(
      v_cam_a,
      format('select public.cancel_outreach_schedule(%L)', v_stale_claim)
    ),
    v_stale_claim,
    'a STALE claim does not block cancellation — crashed workers must not lock schedules forever'
  );

  return next ok(
    (select send_status = 'draft' and scheduled_at is null and send_claimed_at is null
       from public.outreach_messages where id = v_stale_claim),
    'cancellation cleared the stale claim along with the schedule'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.schedule_outreach_send(%L, now() - interval ''1 hour'')', v_draft)
    ),
    '22007',
    'a past delivery time is refused outright'
  );

  return next is(
    tests.uuid_as(
      v_cam_a,
      format('select public.schedule_outreach_send(%L, now() + interval ''2 hours'')', v_draft)
    ),
    v_draft,
    'success path: the draft''s own CAM schedules it'
  );

  return next ok(
    (select send_status = 'scheduled'
        and scheduled_at > now()
        and subject = 'Hello S'
        and body = 'Body'
        and sent_by_user_id = v_cam_a
       from public.outreach_messages where id = v_draft),
    'the transition flipped draft→scheduled with time and scheduler recorded — and left the saved content untouched (the RPC takes none)'
  );

  return next ok(
    (select count(*) = 1
       from public.audit_log
      where target_table = 'outreach_messages'
        and target_id = v_draft
        and action = 'outreach_email_scheduled'),
    'audit-log pattern §1: exactly one audit row for the scheduling'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.schedule_outreach_send(%L, now() + interval ''3 hours'')', v_draft)
    ),
    'P0002',
    'double-scheduling: a second schedule after success raises'
  );

  return next is(
    tests.uuid_as(
      v_cam_a,
      format('select public.cancel_outreach_schedule(%L)', v_draft)
    ),
    v_draft,
    'the scheduler can cancel — the transition RLS alone could never allow'
  );

  return next ok(
    (select send_status = 'draft' and scheduled_at is null
       from public.outreach_messages where id = v_draft),
    'cancellation flipped scheduled→draft and cleared the time'
  );

  return next ok(
    (select count(*) = 1
       from public.audit_log
      where target_table = 'outreach_messages'
        and target_id = v_draft
        and action = 'outreach_schedule_cancelled'),
    'audit-log pattern §1: exactly one audit row for the cancellation'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.cancel_outreach_schedule(%L)', v_draft)
    ),
    'P0002',
    'double-cancel: cancelling an already-cancelled (draft) message raises'
  );

  return next is(
    tests.uuid_as(
      v_admin,
      format('select public.schedule_outreach_send(%L, now() + interval ''4 hours'')', v_draft)
    ),
    v_draft,
    'an admin may schedule any draft, same rule as sending'
  );

  return next is(
    tests.uuid_as(
      v_admin,
      format('select public.cancel_outreach_schedule(%L)', v_draft)
    ),
    v_draft,
    'an admin may cancel any schedule, same rule as sending'
  );
end;
$$;

select * from tests.suite_scheduled_outreach();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();
