-- Send-reviewed-outreach RPC behaviour tests — F123 (#120), PR #458 review fixes.
-- Spec: docs/audit-log-pattern.md; issue #120 testing notes. Run by `supabase test db`.
--
-- Covers public.claim_outreach_send and public.mark_outreach_sent — the two RPCs
-- behind "Send reviewed email". The things worth a database test rather than a unit
-- test are exactly the ones the PR review flagged: a non-owner's attempt is REFUSED
-- (42501) rather than silently matching zero rows while the email still goes out;
-- only one of two competing sends can win the claim; an already-sent draft cannot be
-- recorded as sent again; suppressed clients are refused at point-of-send; and the
-- draft→sent flip lands its audit_log row in the same transaction — with the actual
-- delivered recipient recorded on both the row and the audit entry (F116 review
-- follow-up).
--
-- Like bulk_status_rpc.test.sql these run as real end-user roles, never as
-- service_role or the owning role: the RPCs are SECURITY DEFINER, so testing them
-- as a superuser would exercise a code path no user can reach.
--
-- The harness below is a deliberate copy of that file's rather than an import:
-- pg_prove runs each file in its own session and transaction.

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

-- ---------------------------------------------------------------------------
-- Fixtures: two CAMs, one admin, one org each, drafts in the states the suite needs.
-- ---------------------------------------------------------------------------

create or replace function tests.seed_send()
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
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    ('00000000-0000-4000-c000-000000000001', 'CAM A Client',        'manual', 'other', v_cam_a),
    ('00000000-0000-4000-c000-000000000002', 'CAM B Client',        'manual', 'other', v_cam_b),
    ('00000000-0000-4000-c000-000000000003', 'Suppressed Client',   'manual', 'other', v_cam_a);

  -- cam_a owns one draft on their own client; cam_b owns one on theirs; cam_a also
  -- owns a draft on the suppressed client; one already-sent message for resend tests.
  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, sent_at)
  values
    ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-c000-000000000001', v_cam_a, 'Hello',      'Body', 'draft', null),
    ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-c000-000000000002', v_cam_b, 'Hello B',    'Body', 'draft', null),
    ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-c000-000000000003', v_cam_a, 'Suppressed', 'Body', 'draft', null),
    ('00000000-0000-4000-d000-000000000004', '00000000-0000-4000-c000-000000000001', v_cam_a, 'Already out','Body', 'sent',  now());

  insert into public.suppressions (organisation_id, status, reason, requested_by, decided_by, decided_at)
  values ('00000000-0000-4000-c000-000000000003', 'active', 'Do not contact (test)', v_cam_a, v_admin, now())
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_send_reviewed()
returns setof text language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000003';
  v_draft_a     uuid := '00000000-0000-4000-d000-000000000001';
  v_draft_b     uuid := '00000000-0000-4000-d000-000000000002';
  v_suppressed  uuid := '00000000-0000-4000-d000-000000000003';
  v_already_out uuid := '00000000-0000-4000-d000-000000000004';
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if to_regprocedure('public.claim_outreach_send(uuid)') is null
     or to_regprocedure('public.mark_outreach_sent(uuid,text,text,text)') is null then
    return next skip(1, 'send-reviewed RPCs not yet migrated');
    return;
  end if;

  perform tests.seed_send();

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.claim_outreach_send(%L)', v_draft_a)
    ),
    '42501',
    'AC4: another CAM claiming someone else''s draft is refused, not silently no-oped'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.mark_outreach_sent(%L, ''pm'', ''pt'', ''client@example.org'')', v_draft_a)
    ),
    '42501',
    'AC4: another CAM recording a send on someone else''s draft is refused'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.claim_outreach_send(%L)', v_suppressed)
    ),
    'P0001',
    'AC2: a suppressed client cannot be claimed for sending, whatever the UI said'
  );

  return next is(
    tests.bool_as(
      v_cam_a,
      format('select public.claim_outreach_send(%L)', v_draft_a)
    ),
    true,
    'the draft''s own CAM wins the first claim'
  );

  return next is(
    tests.bool_as(
      v_admin,
      format('select public.claim_outreach_send(%L)', v_draft_a)
    ),
    false,
    'a second concurrent sender (even an admin) loses the claim before any Gmail call'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.mark_outreach_sent(%L, ''pm-1'', ''pt-1'', ''on-file@example.org'')', v_already_out)
    ),
    'P0002',
    'recording a send against an already-sent message raises instead of double-recording'
  );

  return next is(
    tests.uuid_as(
      v_cam_a,
      -- F116 review follow-up: the deliberately overridden address, NOT the one
      -- on file, is what this draft is recorded as having delivered.
      format('select public.mark_outreach_sent(%L, ''pm-1'', ''pt-1'', ''override@example.org'')', v_draft_a)
    ),
    v_draft_a,
    'success path: the owner records the delivery'
  );

  return next ok(
    (select send_status = 'sent' and sent_at is not null
       from public.outreach_messages where id = v_draft_a),
    'the transition flipped draft→sent with its timestamp'
  );

  return next is(
    (select sent_to_email from public.outreach_messages where id = v_draft_a),
    'override@example.org',
    'F116: the delivered recipient is persisted exactly as passed, override included'
  );

  return next ok(
    (select count(*) = 1
       from public.audit_log
      where target_table = 'outreach_messages'
        and target_id = v_draft_a
        and action = 'outreach_email_sent'),
    'audit-log pattern §1: exactly one audit row, same transaction as the flip'
  );

  return next is(
    (select detail ->> 'sent_to' from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_draft_a
        and action = 'outreach_email_sent'),
    'override@example.org',
    'F116: the audit row names who actually received the email'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.mark_outreach_sent(%L, ''pm-2'', ''pt-2'', ''again@example.org'')', v_draft_a)
    ),
    'P0002',
    'double-recordal: a second mark after success raises'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.claim_outreach_send(%L)', v_draft_a)
    ),
    null,  -- succeeds…
    'claiming after a completed send does not error…'
  );

  return next is(
    tests.bool_as(
      v_cam_b,
      format('select public.claim_outreach_send(%L)', v_draft_b)
    ),
    true,
    'an unrelated draft is unaffected by the first send''s claim'
  );
end;
$$;

select * from tests.suite_send_reviewed();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();

rollback;
