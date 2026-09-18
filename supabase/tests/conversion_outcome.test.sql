-- Conversion tracking tests — F143 (#138)
-- Spec: issue #138 AC1/AC2/AC3 + testing notes, incl. the PM ruling of
-- 26 Aug 2026 that OUTCOMES tracks *currently*-converted clients (a revert
-- deletes the row, audited). Run by `supabase test db` (pg_prove).
--
-- Covers what set_outreach_status / set_outreach_status_bulk do ON TOP of the
-- status change itself (the status-change behaviour proper is bulk_status_rpc's
-- and rls_policies' territory): landing on 'converted' records exactly one
-- OUTCOMES row per client, attributed to the most recent SENT email; leaving
-- 'converted' deletes it again; and no outcome type can be hand-written any
-- more (F144 made all five system-managed) —
-- the RPCs are the only ordinary path.
--
-- Like every suite here these run as real end-user roles through the RPCs, never
-- as service_role or the owning role — the RPC is SECURITY DEFINER, so testing it
-- as a superuser would exercise a code path no user can reach.
--
-- Everything runs inside one transaction and is rolled back; fixtures never persist.

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

create or replace function tests.status_as(p_user_id uuid, p_org uuid, p_status text)
returns uuid language plpgsql as $$
declare v_result uuid;
begin
  perform tests.login_as(p_user_id);
  select public.set_outreach_status(p_org, p_status::public.outreach_status) into v_result;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_result;
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

-- The conversions recorded for a client, as (count, attributed message ids).
create or replace function tests.conversions_of(p_org uuid)
returns table(n bigint, message_ids uuid[])
language sql as $$
  select count(*), array_agg(outreach_message_id order by created_at)
    from public.outcomes
   where organisation_id = p_org
     and outcome_type = 'converted';
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function tests.seed_conversion()
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

  -- Four CAM A clients covering the attribution matrix:
  --   emailed      — two sent emails plus a draft: attribution must be the NEWEST sent
  --   never_sent   — no outreach_messages rows at all
  --   draft_only   — a draft only, which is not an attempt that went out
  --   plain        — nothing special; used for the bulk and duplicate branches
  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values
    ('00000000-0000-4000-c000-000000000101', 'Emailed Client',    'manual', 'other', v_cam_a, 'not_contacted'),
    ('00000000-0000-4000-c000-000000000102', 'Never Emailed',     'manual', 'other', v_cam_a, 'not_contacted'),
    ('00000000-0000-4000-c000-000000000103', 'Draft Only',        'manual', 'other', v_cam_a, 'responded'),
    ('00000000-0000-4000-c000-000000000104', 'Bulk Client',       'manual', 'other', v_cam_a, 'not_contacted')
  on conflict (id) do nothing;

  -- Two sent attempts (older first) and a draft on the same client. sent_at drives
  -- attribution; the draft carries none by its own constraint.
  insert into public.outreach_messages
    (id, organisation_id, subject, body, send_status, sent_at)
  values
    ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000101',
     'First attempt', 'hello', 'sent', now() - interval '10 days'),
    ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000101',
     'Follow-up attempt', 'again', 'sent', now() - interval '2 days'),
    ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-c000-000000000101',
     'Unsent draft', 'never left the building', 'draft', null),
    ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-c000-000000000103',
     'Only ever drafted', 'still here', 'draft', null)
  on conflict (id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_conversion()
returns setof text language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b uuid := '00000000-0000-4000-a000-000000000003';
  -- Sent attempts on Emailed Client, old then new.
  v_old_message uuid := '00000000-0000-4000-b000-000000000001';
  v_new_message uuid := '00000000-0000-4000-b000-000000000002';
  v_emailed     uuid := '00000000-0000-4000-c000-000000000101';
  v_never_sent  uuid := '00000000-0000-4000-c000-000000000102';
  v_draft_only  uuid := '00000000-0000-4000-c000-000000000103';
  v_bulk        uuid := '00000000-0000-4000-c000-000000000104';
begin
  -- Lets the file merge ahead of its migration, same convention as the other suites.
  if to_regclass('public.outcomes_one_outcome_per_type') is null
     and to_regclass('public.outcomes_one_conversion_per_client') is null then
    return next skip(1, 'conversion tracking not yet migrated');
    return;
  end if;

  perform tests.seed_conversion();

  -- AC1: flipping to converted IS the recording — no separate log step.
  perform tests.status_as(v_cam_a, v_emailed, 'converted');

  return next is(
    (select n from tests.conversions_of(v_emailed)),
    1::bigint,
    'converting a client records exactly one conversion'
  );

  -- AC2: tied back to the most recent SENT attempt, not the older one or the draft.
  return next is(
    (select message_ids from tests.conversions_of(v_emailed)),
    array[v_new_message],
    'the conversion is attributed to the most recent sent email, ignoring older ones and drafts'
  );

  return next is(
    (select recorded_by_user_id from public.outcomes
      where organisation_id = v_emailed and outcome_type = 'converted'),
    v_cam_a,
    'the conversion names the actor who made the status change'
  );

  -- "missing tracking data": a client never emailed still converts, carrying a
  -- null attribution rather than no record at all.
  perform tests.status_as(v_cam_a, v_never_sent, 'converted');

  return next is(
    (select (n, message_ids) from tests.conversions_of(v_never_sent)),
    (1::bigint, array[null::uuid]),
    'a never-emailed client records a conversion with a null message attribution'
  );

  -- A draft is not an attempt that went out: it cannot be what led to it either.
  perform tests.status_as(v_cam_a, v_draft_only, 'converted');

  return next is(
    (select (n, message_ids) from tests.conversions_of(v_draft_only)),
    (1::bigint, array[null::uuid]),
    'draft-only history converts with a null attribution — drafts are not attempts'
  );

  -- "duplicate event": revert to fix a genuine mistake, convert again. The PM
  -- ruling on #138 (26 Aug 2026) makes OUTCOMES track *currently*-converted
  -- clients, so the revert deletes the row — audited — and the re-conversion
  -- inserts a fresh one.
  perform tests.status_as(v_cam_a, v_emailed, 'responded');

  return next is(
    (select n from tests.conversions_of(v_emailed)),
    0::bigint,
    'reverting a converted client withdraws its tracked conversion'
  );

  return next is(
    (select count(*)::int from public.audit_log
      where action = 'outcome_deleted' and target_table = 'outcomes'
        and detail->>'organisation_id' = v_emailed::text),
    1,
    'the withdrawal is itself audited, with the client named in the detail'
  );

  perform tests.status_as(v_cam_a, v_emailed, 'converted');

  return next is(
    (select message_ids from tests.conversions_of(v_emailed)),
    array[v_new_message],
    'converting again after a revert records one fresh, correctly attributed conversion'
  );

  -- Setting the status a client is already on stays a clean no-op end to end.
  perform tests.status_as(v_cam_a, v_emailed, 'converted');

  return next is(
    (select n from tests.conversions_of(v_emailed)),
    1::bigint,
    're-setting converted on an already-converted client writes nothing further'
  );

  -- The bulk path records per-org off the same snapshot the update read.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status_bulk(array[%L, %L]::uuid[], ''converted''::public.outreach_status)',
      v_bulk, v_never_sent)),
    null,
    'a bulk move onto converted succeeds'
  );

  return next is(
    (select count(*)::int from public.outcomes
      where organisation_id = v_bulk and outcome_type = 'converted'),
    1,
    'the bulk move recorded the conversion for the batch member'
  );

  -- A refused batch applies nothing, including its conversions.
  return next is(
    tests.sqlstate_of(v_cam_b, format(
      'select public.set_outreach_status_bulk(array[%L]::uuid[], ''converted''::public.outreach_status)',
      v_bulk)),
    '42501',
    'another CAM''s client is refused in bulk, as singly'
  );

  return next ok(
    (select n from tests.conversions_of(v_bulk)) = 1,
    'the refused batch recorded nothing extra — no partial application'
  );

  return next ok(
    (select count(*)::int from public.audit_log
      where action = 'status_changed' and target_id = v_bulk) = 1,
    'exactly one audit row stands behind the conversion — no new audit action was invented'
  );

  -- AC3 under the PM ruling: OUTCOMES tracks *currently*-converted clients, so a
  -- bulk revert withdraws every batch member's tracked conversion, audited.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status_bulk(array[%L, %L]::uuid[], ''not_contacted''::public.outreach_status)',
      v_bulk, v_never_sent)),
    null,
    'a bulk revert off converted succeeds'
  );

  return next is(
    (select count(*)::int from public.outcomes
      where organisation_id in (v_bulk, v_never_sent)
        and outcome_type = 'converted'),
    0,
    'the bulk revert withdrew the tracked conversion of every batch member'
  );

  return next is(
    (select count(*)::int from public.audit_log
      where action = 'outcome_deleted' and target_table = 'outcomes'
        and detail->>'organisation_id' in (v_bulk::text, v_never_sent::text)),
    2,
    'each bulk withdrawal is audited against its client'
  );

  -- Conversions are system-managed: the RPCs are the only ordinary write path,
  -- so a CAM's hand-written rows can never disagree with the pipeline.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.outcomes (organisation_id, outcome_type, recorded_by_user_id) values (%L, ''converted'', %L)',
      v_draft_only, v_cam_a)),
    '42501',
    'a CAM cannot hand-insert a converted outcome'
  );

  -- F144 made every taxonomy value system-managed, not just conversions: the
  -- insert is refused, so no hand-written row exists to rename later.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'insert into public.outcomes (organisation_id, outcome_type, recorded_by_user_id) values (%L, ''no_response'', %L)',
      v_never_sent, v_cam_a)),
    '42501',
    'a CAM cannot hand-write any outcome type — all five mirror the pipeline'
  );

  -- An UPDATE filtered out by the policy's USING clause touches zero rows rather
  -- than raising, so assert on the effect instead of an error code.
  perform tests.sqlstate_of(v_cam_a, format(
    'update public.outcomes set notes = ''tampered'' where organisation_id = %L and outcome_type = ''converted''',
    v_emailed));

  return next is(
    (select notes from public.outcomes
      where organisation_id = v_emailed and outcome_type = 'converted'),
    null,
    'a CAM cannot edit a converted outcome row, even their own'
  );

  -- The rename attempt needs a row to aim at — seeded as admin (the only
  -- ordinary writer left besides the RPCs), then attacked as a CAM. An UPDATE
  -- filtered out by RLS touches zero rows and succeeds silently, so assert on
  -- the effect: the row must survive untouched.
  perform tests.sqlstate_of(v_admin, format(
    'insert into public.outcomes (organisation_id, outcome_type, recorded_by_user_id) values (%L, ''no_response'', %L)',
    v_bulk, v_admin));

  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'update public.outcomes set outcome_type = ''converted'' where organisation_id = %L and outcome_type = ''no_response''',
      v_bulk)),
    null,
    'the rename attempt raises nothing — RLS filters it to zero rows'
  );

  return next is(
    (select outcome_type::text from public.outcomes where organisation_id = v_bulk),
    'no_response',
    'a CAM cannot rename another outcome type into converted — the row survived'
  );

  return next is(
    tests.sqlstate_of(v_admin, format(
      'insert into public.outcomes (organisation_id, outcome_type, recorded_by_user_id) values (%L, ''converted'', %L)',
      v_bulk, v_admin)),
    null,
    'the deliberate admin override to hand-record a conversion survives'
  );
end;
$$;

select tests.suite_conversion();

select * from finish();
rollback;
