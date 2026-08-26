-- Discard-outreach-draft tests — F120 (#117), PR #493 review follow-ups.
-- Run by `supabase test db`.
--
-- Covers the two things the PR review flagged:
--   1. public.discard_outreach_draft (20260902130000) — the audited SECURITY
--      DEFINER RPC behind "Discard this draft": authorisation re-checks inside
--      the body, drafts-only refusal, and the outreach_email_draft_discarded
--      audit row landing in the same transaction as the delete
--      (docs/audit-log-pattern.md §1, F042's discard_manual_entry_draft precedent).
--   2. The outreach_messages_delete_own_draft / _delete_admin RLS policies
--      themselves, which shipped in 20260804190000_create_outreach.sql but were
--      never exercised by any suite.
--
-- Like send_reviewed_rpc.test.sql these run as real end-user roles, never as
-- service_role or the owning role: the RPC is SECURITY DEFINER, so testing it as
-- a superuser would exercise a code path no user can reach.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ---------------------------------------------------------------------------
-- Harness (deliberate copy of send_reviewed_rpc.test.sql — pg_prove runs each
-- file in its own session and transaction)
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

-- ---------------------------------------------------------------------------
-- Fixtures: two CAMs, one admin, one org each, drafts in the states the suite needs.
-- ---------------------------------------------------------------------------

create or replace function tests.seed_discard()
returns void language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000101';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000102';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000103';
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
    ('00000000-0000-4000-c000-000000010001', 'CAM A Client', 'manual', 'other', v_cam_a),
    ('00000000-0000-4000-c000-000000010002', 'CAM B Client', 'manual', 'other', v_cam_b);

  -- Drafts in every state the suite needs: one per CAM, plus an already-sent
  -- message and a reviewed recipient on cam_a's draft to assert what survives
  -- into the audit row.
  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, sent_at, sent_to_email)
  values
    ('00000000-0000-4000-d000-000000010001', '00000000-0000-4000-c000-000000010001', v_cam_a, 'Hello from A',   'Body', 'draft', null,   'reviewed@example.org'),
    ('00000000-0000-4000-d000-000000010002', '00000000-0000-4000-c000-000000010002', v_cam_b, 'Hello from B',   'Body', 'draft', null,   null),
    ('00000000-0000-4000-d000-000000010003', '00000000-0000-4000-c000-000000010001', v_cam_a, 'Already out',    'Body', 'sent',  now(),  'on-file@example.org');
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_discard()
returns setof text language plpgsql as $$
declare
  v_admin  uuid := '00000000-0000-4000-a000-000000000101';
  v_cam_a  uuid := '00000000-0000-4000-a000-000000000102';
  v_cam_b  uuid := '00000000-0000-4000-a000-000000000103';
  v_draft_a  uuid := '00000000-0000-4000-d000-000000010001';
  v_draft_b  uuid := '00000000-0000-4000-d000-000000010002';
  v_already_out uuid := '00000000-0000-4000-d000-000000010003';
  v_missing  uuid := '00000000-0000-4000-d000-000000010099';
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if to_regprocedure('public.discard_outreach_draft(uuid)') is null then
    return next skip(1, 'discard_outreach_draft not yet migrated');
    return;
  end if;

  perform tests.seed_discard();

  -- --- RLS DELETE policies (never previously exercised by any suite) --------

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('delete from public.outreach_messages where id = %L', v_missing)
    ),
    null,
    'policy: a zero-row delete is permitted by RLS (app detects it via returning)'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('delete from public.outreach_messages where id = %L', v_draft_a)
    ),
    '42501',
    'policy: a CAM cannot delete another CAM''s draft'
  );

  return next ok(
    (select count(*) = 1 from public.outreach_messages where id = v_draft_a),
    'policy: the foreign draft survived the refused delete'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('delete from public.outreach_messages where id = %L', v_already_out)
    ),
    '42501',
    'policy: nothing may delete an already-sent message'
  );

  -- --- RPC behaviour ---------------------------------------------------------

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.discard_outreach_draft(%L)', v_draft_a)
    ),
    '42501',
    'RPC: another CAM''s discard is refused by the body''s own re-check'
  );

  return next ok(
    (select count(*) = 1 from public.outreach_messages where id = v_draft_a),
    'RPC: the refused discard left the draft in place'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.discard_outreach_draft(%L)', v_already_out)
    ),
    '42501',
    'RPC: an already-sent message is refused even for its own CAM'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.discard_outreach_draft(%L)', v_missing)
    ),
    '42501',
    'RPC: an unknown id refuses rather than silently matching zero rows'
  );

  return next is(
    has_function_privilege('anon', 'public.discard_outreach_draft(uuid)', 'execute'),
    false,
    'security: anon has no EXECUTE on the discard RPC'
  );

  return next is(
    has_function_privilege('public', 'public.discard_outreach_draft(uuid)', 'execute'),
    false,
    'security: PUBLIC has no EXECUTE on the discard RPC'
  );

  -- Success path last so the fixture rows above stay intact for their assertions.
  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.discard_outreach_draft(%L)', v_draft_a)),
    null,
    'success path: the draft''s own CAM can discard it'
  );

  return next ok(
    (select count(*) = 0 from public.outreach_messages where id = v_draft_a),
    'the discarded row is gone'
  );

  return next is(
    (select detail ->> 'subject' from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_draft_a
        and action = 'outreach_email_draft_discarded'),
    'Hello from A',
    'audit-log pattern §1: the discard is recorded with enough of the draft to answer for it later'
  );

  return next is(
    (select detail ->> 'sent_to_email' from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_draft_a
        and action = 'outreach_email_draft_discarded'),
    'reviewed@example.org',
    'the audit row keeps the reviewed recipient — the row itself is gone'
  );

  return next is(
    (select actor_user_id from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_draft_a
        and action = 'outreach_email_draft_discarded'),
    v_cam_a,
    'the audit row names who discarded it'
  );

  -- Admin path: any unsent draft, still audited.
  return next is(
    tests.sqlstate_of(v_admin, format('select public.discard_outreach_draft(%L)', v_draft_b)),
    null,
    'an admin may discard another CAM''s unsent draft'
  );

  return next ok(
    (select count(*) = 1
       from public.audit_log
      where target_table = 'outreach_messages' and target_id = v_draft_b
        and action = 'outreach_email_draft_discarded'),
    'the admin''s discard is audited too'
  );
end;
$$;

select * from tests.suite_discard();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();

rollback;
