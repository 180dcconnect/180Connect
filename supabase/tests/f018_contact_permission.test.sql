-- F018 (#21) Contact Permission Rules — RPC enforcement tests.
-- Spec: docs/rls-permission-matrix.md §3.4. Run by `supabase test db`.
--
-- Covers the tightened authorisation predicate in public.claim_outreach_send,
-- public.schedule_outreach_send and public.mark_outreach_sent (migration
-- 20260911130000): owning the DRAFT no longer licences a send — the author
-- clause holds only while nobody owns the client. This is the "direct API call"
-- testing case from the ticket: a caller that bypasses the UI entirely must hit
-- the same wall the app enforces.
--
-- Harness deliberately copied from scheduled_outreach_rpc.test.sql (pg_prove
-- runs each file in its own session and transaction); runs as real end-user
-- roles, never service_role or the owning role.

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

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function tests.seed_f018()
returns void language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000021';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000022';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000023';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-f018@180dc.org'),
    (v_cam_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a-f018@180dc.org'),
    (v_cam_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b-f018@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin, 'admin-f018@180dc.org', 'Test Admin F018', 'admin', true),
    (v_cam_a, 'cam-a-f018@180dc.org', 'Test CAM A F018', 'cam',   true),
    (v_cam_b, 'cam-b-f018@180dc.org', 'Test CAM B F018', 'cam',   true)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    -- Owned by CAM A: drafts on it were authored by CAM B BEFORE reassignment —
    -- the exact residue the old rule let slip through.
    ('00000000-0000-4000-c000-000000000021', 'F018 CAM A Client', 'manual', 'other', v_cam_a),
    ('00000000-0000-4000-c000-000000000022', 'F018 CAM B Client', 'manual', 'other', v_cam_b),
    ('00000000-0000-4000-c000-000000000023', 'F018 Unowned Client', 'manual', 'other', null);

  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status)
  values
    -- THE F018 case: author (CAM B) ≠ owner (CAM A).
    ('00000000-0000-4000-d000-000000000021', '00000000-0000-4000-c000-000000000021', v_cam_b, 'Reassigned S',  'Body', 'draft'),
    -- Owner sending someone else's draft on their OWN client stays legal.
    ('00000000-0000-4000-d000-000000000022', '00000000-0000-4000-c000-000000000021', v_cam_b, 'Owner case S',  'Body', 'draft'),
    -- Author on an UNOWNED client keeps their licence.
    ('00000000-0000-4000-d000-000000000023', '00000000-0000-4000-c000-000000000023', v_cam_b, 'Unowned S',     'Body', 'draft');
end;
$$;

-- Releases any fresh send claim so a later claim attempt starts clean. Runs
-- unsandboxed (test session role), like the seeding above.
create or replace function tests.release_claim(p_message_id uuid)
returns void language plpgsql as $$
begin
  update public.outreach_messages set send_claimed_at = null where id = p_message_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_f018_contact_permission()
returns setof text language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000021';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000022';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000023';
  v_reassigned uuid := '00000000-0000-4000-d000-000000000021';
  v_owner_case uuid := '00000000-0000-4000-d000-000000000022';
  v_unowned    uuid := '00000000-0000-4000-d000-000000000023';
begin
  -- Lets the file merge ahead of its migration, same convention as the RLS suite.
  if to_regprocedure('public.claim_outreach_send(uuid)') is null
     or to_regprocedure('public.schedule_outreach_send(uuid,timestamptz)') is null
     or to_regprocedure('public.mark_outreach_sent(uuid,text,text,text,jsonb)') is null then
    return next skip(1, 'outreach send RPCs not yet migrated');
    return;
  end if;

  perform tests.seed_f018();

  -- --- THE core refusals: author ≠ owner, client owned elsewhere ------------

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.schedule_outreach_send(%L, now() + interval ''1 day'')', v_reassigned)
    ),
    '42501',
    'F018 AC4/direct API: the author of a draft cannot SCHEDULE it once another CAM owns the client'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.claim_outreach_send(%L)', v_reassigned)
    ),
    '42501',
    'F018 AC4/direct API: the author cannot CLAIM the Gmail send either'
  );

  return next is(
    tests.sqlstate_of(
      v_cam_b,
      format('select public.mark_outreach_sent(%L, ''prov-msg'', ''prov-thread'', ''x@example.org'', null::jsonb)', v_reassigned)
    ),
    '42501',
    'F018 AC4/direct API: the author cannot RECORD the send — recording is no more reachable than claiming'
  );

  -- Assert resulting state, not just the error: nothing may have moved.
  return next ok(
    (select send_status = 'draft' and send_claimed_at is null
       from public.outreach_messages where id = v_reassigned),
    'the refused author''s draft is untouched — still a plain, unclaimed draft'
  );

  -- --- Admin override survives (AC3) ----------------------------------------

  return next ok(
    tests.bool_as(v_admin, format('select public.claim_outreach_send(%L)', v_reassigned)),
    'an admin may still claim a draft on another CAM''s client (last-resort override)'
  );
  perform tests.release_claim(v_reassigned);

  -- --- Owner override survives ----------------------------------------------

  return next ok(
    tests.bool_as(v_cam_a, format('select public.claim_outreach_send(%L)', v_owner_case)),
    'the client''s OWNER may send a draft someone else authored on their own client'
  );
  perform tests.release_claim(v_owner_case);

  -- --- Unowned client: the author keeps their licence ------------------------

  return next ok(
    tests.bool_as(v_cam_b, format('select public.claim_outreach_send(%L)', v_unowned)),
    'on an UNOWNED client the draft author may still claim the send (matches can_contact_organisation)'
  );
  perform tests.release_claim(v_unowned);

  return next is(
    tests.uuid_as(
      v_cam_b,
      format('select public.schedule_outreach_send(%L, now() + interval ''2 hours'')', v_unowned)
    ),
    v_unowned,
    'success path: scheduling on an unowned client works end-to-end for its author'
  );

  return next ok(
    (select count(*) = 1
       from public.audit_log
      where target_table = 'outreach_messages'
        and target_id = v_unowned
        and action = 'outreach_email_scheduled'),
    'audit-log pattern §1: the permitted schedule lands exactly one audit row'
  );

  -- --- A third party is still refused outright -------------------------------

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('select public.schedule_outreach_send(%L, now() + interval ''3 hours'')', v_unowned)
    ),
    '42501',
    'a CAM who neither owns the client nor authored the draft is refused even on an unowned client'
  );
end;
$$;

select * from tests.suite_f018_contact_permission();

-- Emits the deferred plan (no_plan above) — without this pg_prove reports
-- "No plan found in TAP output" even when every subtest passed.
select * from finish();
