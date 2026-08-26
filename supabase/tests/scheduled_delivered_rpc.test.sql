-- Scheduled-delivery recordal RPC behaviour tests — F157 (#152), extending F126/F129.
-- Spec: docs/audit-log-pattern.md; issue #152 acceptance criteria. Run by `supabase test db`.
--
-- Covers public.mark_scheduled_outreach_delivered — the cron worker's scheduled→sent
-- transition, which before F157 was a raw service-role UPDATE: it recorded a
-- delivered email with NO audit_log row and NEVER advanced the client's pipeline.
-- The things worth a database test here: a signed-in user is refused outright;
-- the flip is pinned to THIS run's exact claim token (a raced cancel or re-claim
-- wins); success records SEND_EVENTS + AUDIT_LOG and advances the pipeline in ONE
-- transaction; a second delivery to the same client reads follow_up_sent; and an
-- already-sent message cannot be recorded twice.
--
-- Like send_reviewed_rpc.test.sql these run as real roles — authenticated users to
-- prove refusal, service_role to exercise the grant — never as a superuser.

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

create or replace function tests.sqlstate_as_authenticated(p_sql text)
returns text language plpgsql as $$
declare v_state text;
begin
  perform tests.login_as('00000000-0000-4000-a000-000000000002');
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

create or replace function tests.service_bool_as(p_sql text)
returns boolean language plpgsql as $$
declare v_result boolean;
begin
  execute 'set local role service_role';
  execute p_sql into v_result;
  execute 'reset role';
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: one CAM owning one client, with two scheduled messages queued on it.
-- ---------------------------------------------------------------------------

create or replace function tests.seed_scheduled()
returns void language plpgsql as $$
declare
  v_cam_a uuid := '00000000-0000-4000-a000-000000000002';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_cam_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values (v_cam_a, 'cam-a@180dc.org', 'Test CAM A', 'cam', true)
  on conflict (id) do update
    set role = excluded.role, is_active = excluded.is_active;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values ('00000000-0000-4000-c000-000000000001', 'Scheduled Client', 'manual', 'other', v_cam_a);

  -- Two queued deliveries on the same client: the first exercises the initial
  -- advance, the second the follow_up_sent one. Claims carry each "run's" token.
  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, scheduled_at, send_claimed_at)
  values
    ('00000000-0000-4000-d000-000000000101', '00000000-0000-4000-c000-000000000001', v_cam_a, 'Queued hello',   'Body', 'scheduled', now(), '2026-09-05T10:00:00Z'),
    ('00000000-0000-4000-d000-000000000102', '00000000-0000-4000-c000-000000000001', v_cam_a, 'Queued hello 2', 'Body', 'scheduled', now(), '2026-09-05T10:05:00Z');
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_scheduled_delivered()
returns setof text language plpgsql as $$
declare
  v_msg_1   uuid := '00000000-0000-4000-d000-000000000101';
  v_msg_2   uuid := '00000000-0000-4000-d000-000000000102';
  v_org     uuid := '00000000-0000-4000-c000-000000000001';
  v_token_1 timestamptz := '2026-09-05T10:00:00Z';
  v_token_2 timestamptz := '2026-09-05T10:05:00Z';
begin
  if to_regprocedure('public.mark_scheduled_outreach_delivered(uuid,text,text,timestamptz,jsonb)') is null then
    return next skip(1, 'mark_scheduled_outreach_delivered not yet migrated');
    return;
  end if;

  perform tests.seed_scheduled();

  -- A signed-in user has no business recording someone else's queued email:
  -- manual sends go through mark_outreach_sent instead.
  return next is(
    tests.sqlstate_as_authenticated(
      format('select public.mark_scheduled_outreach_delivered(%L, ''pm'', ''pt'', %L)',
             v_msg_1, v_token_1)
    ),
    '42501',
    'an authenticated user cannot record a scheduled delivery'
  );

  -- Wrong token = cancelled or claimed elsewhere mid-run: false, nothing changed.
  return next is(
    tests.service_bool_as(format(
      'select public.mark_scheduled_outreach_delivered(%L, ''pm-x'', ''pt-x'', %L)',
      v_msg_1, '2026-09-05T09:59:59Z')),
    false,
    'a stale/foreign claim token matches no rows — ambiguous, reported by the caller'
  );
  return next ok(
    (select send_status = 'scheduled' from public.outreach_messages where id = v_msg_1),
    'the refused flip left the message untouched'
  );

  -- The happy path: our own claim wins, everything lands atomically.
  return next is(
    tests.service_bool_as(format(
      'select public.mark_scheduled_outreach_delivered(%L, ''pm-1'', ''pt-1'', %L)',
      v_msg_1, v_token_1)),
    true,
    'the worker''s exact claim records the delivered email'
  );

  return next ok(
    (select send_status = 'sent' and sent_at is not null
       from public.outreach_messages where id = v_msg_1),
    'the flip moved scheduled→sent with its timestamp'
  );

  return next ok(
    (select count(*) = 1 from public.send_events
      where outreach_message_id = v_msg_1 and event_type = 'sent'),
    'the SEND_EVENTS ''sent'' row landed in the same transaction'
  );

  return next ok(
    (select count(*) = 1 from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_msg_1
        and action = 'outreach_email_sent'
        and actor_user_id is null),
    'audit-log pattern §1: one system-attributed audit row for the delivery'
  );

  return next is(
    (select detail ->> 'provider_message_id' from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_msg_1
        and action = 'outreach_email_sent'),
    'pm-1',
    'the audit row carries the Gmail provider ids'
  );

  -- F157 AC1: a first-ever send leaves the client off not_contacted…
  return next is(
    (select outreach_status from public.organisations where id = v_org),
    'initial_outreach_sent'::public.outreach_status,
    'F157 AC1: the scheduled first send advanced the pipeline in the same transaction'
  );

  return next is(
    (select jsonb_build_object('from', detail ->> 'from', 'to', detail ->> 'to')
       from public.audit_log
      where action = 'status_changed' and target_table = 'organisations'
        and target_id = v_org),
    jsonb_build_object('from', 'not_contacted', 'to', 'initial_outreach_sent'),
    'F157: the advance is audited with its before/after statuses'
  );

  -- …and a second delivery to the same client moves FORWARD (AC2).
  return next is(
    tests.service_bool_as(format(
      'select public.mark_scheduled_outreach_delivered(%L, ''pm-2'', ''pt-2'', %L)',
      v_msg_2, v_token_2)),
    true,
    'the second scheduled delivery records successfully'
  );
  return next is(
    (select outreach_status from public.organisations where id = v_org),
    'follow_up_sent'::public.outreach_status,
    'F157 AC2: the second send reads follow_up_sent, never a second initial'
  );

  -- Already-sent messages are not recordable twice.
  return next is(
    tests.service_bool_as(format(
      'select public.mark_scheduled_outreach_delivered(%L, ''pm-again'', ''pt-again'', %L)',
      v_msg_1, v_token_1)),
    false,
    'double-recordal: an already-sent message flips no rows'
  );

  -- The refused double-record rolled back whole: still exactly two status rows.
  return next is(
    (select count(*) from public.audit_log
      where action = 'status_changed' and target_table = 'organisations'
        and target_id = v_org),
    2::bigint,
    'no third pipeline advance was written by the refused retry'
  );

  return next ok(
    not has_function_privilege('authenticated',
      'public.mark_scheduled_outreach_delivered(uuid,text,text,timestamptz,jsonb)', 'EXECUTE'),
    'authenticated holds no EXECUTE on the worker RPC'
  );
  return next ok(
    not has_function_privilege('anon',
      'public.mark_scheduled_outreach_delivered(uuid,text,text,timestamptz,jsonb)', 'EXECUTE'),
    'anon holds no EXECUTE on the worker RPC'
  );
end;
$$;

select * from tests.suite_scheduled_delivered();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();

rollback;
