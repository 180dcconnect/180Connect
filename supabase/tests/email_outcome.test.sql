-- Email outcome tracking tests — F144 (#139)
-- Spec: issue #139 AC1-AC3 + testing notes. Run by `supabase test db` (pg_prove).
--
-- Covers the F144 half of what set_outreach_status / set_outreach_status_bulk do
-- on top of the status change itself: the five terminal statuses ARE the issue's
-- outcome taxonomy, and OUTCOMES mirrors each client's CURRENT terminal state —
-- landing on a terminal status writes its row (attributed to the most recent
-- SENT email), leaving it withdraws the row again, audited. Non-terminal
-- statuses record nothing. This generalises #501's currently-converted model,
-- per the PM, to all five outcomes.
--
-- The taxonomy itself is asserted too: the enum must hold exactly the five
-- issue-defined values and nothing else — that is the PM's signed-off decision,
-- and a stray sixth value would silently widen every future metric.
--
-- Like every suite here these run as real end-user roles through the RPCs.
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

-- The outcomes of one type currently recorded for a client, as (count, ids).
create or replace function tests.outcomes_of(p_org uuid, p_type text)
returns table(n bigint, message_ids uuid[])
language sql as $$
  select count(*), array_agg(outreach_message_id order by created_at)
    from public.outcomes
   where organisation_id = p_org
     and outcome_type::text = p_type;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function tests.seed_outcome()
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

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values
    ('00000000-0000-4000-c000-000000000201', 'Emailed Client', 'manual', 'other', v_cam_a, 'not_contacted'),
    ('00000000-0000-4000-c000-000000000202', 'Never Emailed',  'manual', 'other', v_cam_a, 'not_contacted'),
    ('00000000-0000-4000-c000-000000000203', 'Progression',    'manual', 'other', v_cam_a, 'responded'),
    ('00000000-0000-4000-c000-000000000204', 'Bulk Client',    'manual', 'other', v_cam_a, 'not_contacted')
  on conflict (id) do nothing;

  -- Two sent attempts (older first) plus a draft on Emailed Client. sent_at
  -- drives attribution; the draft carries none by its own constraint.
  insert into public.outreach_messages
    (id, organisation_id, subject, body, send_status, sent_at)
  values
    ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-c000-000000000201',
     'First attempt', 'hello', 'sent', now() - interval '10 days'),
    ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-c000-000000000201',
     'Follow-up attempt', 'again', 'sent', now() - interval '2 days'),
    ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-c000-000000000201',
     'Unsent draft', 'never left the building', 'draft', null)
  on conflict (id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_email_outcome()
returns setof text language plpgsql as $$
declare
  v_admin       uuid := '00000000-0000-4000-a000-000000000001';
  v_cam_a       uuid := '00000000-0000-4000-a000-000000000002';
  v_cam_b       uuid := '00000000-0000-4000-a000-000000000003';
  v_new_message uuid := '00000000-0000-4000-d000-000000000002';
  v_emailed     uuid := '00000000-0000-4000-c000-000000000201';
  v_never_sent  uuid := '00000000-0000-4000-c000-000000000202';
  v_progression uuid := '00000000-0000-4000-c000-000000000203';
  v_bulk        uuid := '00000000-0000-4000-c000-000000000204';
begin
  -- Lets the file merge ahead of its migration, same convention as the other suites:
  -- the new taxonomy is recognisable by 'reply' existing in the enum.
  if not ('reply'::text = any (enum_range(null::public.outcome_type)::text[])) then
    return next skip(1, 'outcome taxonomy not yet migrated');
    return;
  end if;

  -- The taxonomy is exactly what issue #139 defines — the PM's signed-off set,
  -- in declaration order.
  return next is(
    enum_range(null::public.outcome_type)::text[],
    array['reply', 'converted', 'no_response', 'soft_no', 'hard_no'],
    'the outcome enum holds exactly the five issue-defined values'
  );

  perform tests.seed_outcome();

  -- AC1 + AC3: the reply outcome comes from the responded status flip a CAM or
  -- the reply-sync already performs — not from separate tagging.
  perform tests.status_as(v_cam_a, v_emailed, 'responded');

  return next is(
    (select (n, message_ids) from tests.outcomes_of(v_emailed, 'reply')),
    (1::bigint, array[v_new_message]),
    'a replied client records one reply outcome, attributed to the newest sent email'
  );

  return next is(
    (select recorded_by_user_id from public.outcomes
      where organisation_id = v_emailed and outcome_type = 'reply'),
    v_cam_a,
    'the outcome names the actor who made the status change'
  );

  -- Each refusal flavour labels its own way.
  perform tests.status_as(v_cam_a, v_emailed, 'soft_no');

  return next is(
    (select n from tests.outcomes_of(v_emailed, 'soft_no')),
    1::bigint,
    'a soft-no client records one soft_no outcome'
  );

  -- Current-state mirror: moving from one terminal status to another withdraws
  -- the old row — the client's outcome is what it is NOW, not what it was.
  return next is(
    (select n from tests.outcomes_of(v_emailed, 'reply')),
    0::bigint,
    'moving on from responded withdrew the reply row — the mirror holds'
  );

  perform tests.status_as(v_cam_a, v_emailed, 'hard_no');

  return next is(
    (select n from tests.outcomes_of(v_emailed, 'hard_no')),
    1::bigint,
    'a hard-no client records one hard_no outcome'
  );

  -- "duplicate event": mistake-revert then re-land on the same status. The
  -- revert deletes the row (audited); the re-land writes a fresh one.
  perform tests.status_as(v_cam_a, v_emailed, 'responded');

  return next is(
    (select n from tests.outcomes_of(v_emailed, 'hard_no')),
    0::bigint,
    'reverting away from hard_no withdraws its row'
  );

  return next ok(
    (select count(*)::int from public.audit_log
      where action = 'outcome_deleted' and target_table = 'outcomes'
        and detail->>'organisation_id' = v_emailed::text) >= 1,
    'every withdrawal is audited against its client'
  );

  perform tests.status_as(v_cam_a, v_emailed, 'hard_no');

  return next is(
    (select n from tests.outcomes_of(v_emailed, 'hard_no')),
    1::bigint,
    're-landing on hard_no records a fresh outcome'
  );

  -- AC3 end-to-end: soft-no today, converted tomorrow — the table always shows
  -- exactly where the client stands now.
  perform tests.status_as(v_cam_a, v_progression, 'soft_no');
  perform tests.status_as(v_cam_a, v_progression, 'converted');

  return next is(
    (select (count(*), coalesce(array_agg(outcome_type::text), '{}')) from public.outcomes
      where organisation_id = v_progression),
    (1::bigint, array['converted']),
    'a soft-no-then-converted client carries exactly one row: where it stands now'
  );

  -- The third status writer maintains the mirror too: #503's automatic advance
  -- on send pulls a terminal-status client back to follow_up_sent, and the
  -- outcome row must go with it — this is the path that drifted once already.
  perform public.advance_outreach_pipeline_on_send(v_progression, v_admin);

  return next is(
    (select count(*)::int from public.outcomes where organisation_id = v_progression),
    0,
    'a second send advancing a converted client withdraws its outcome row'
  );

  return next ok(
    (select count(*)::int from public.audit_log
      where action = 'outcome_deleted' and target_table = 'outcomes'
        and detail->>'organisation_id' = v_progression::text) >= 1,
    'the send-driven withdrawal is audited like every other'
  );

  -- AC2: non-terminal statuses are not forced into an outcome.
  perform tests.status_as(v_cam_a, v_bulk, 'initial_outreach_sent');
  perform tests.status_as(v_cam_a, v_bulk, 'follow_up_sent');

  return next is(
    (select count(*)::int from public.outcomes where organisation_id = v_bulk),
    0,
    'outreach and follow-up sends record no outcome — unresolved stays unresolved'
  );

  -- The remaining two non-terminal statuses are equally outcome-free.
  perform tests.status_as(v_cam_a, v_bulk, 'future_potential');
  perform tests.status_as(v_cam_a, v_bulk, 'loss_due_timing');

  return next is(
    (select count(*)::int from public.outcomes where organisation_id = v_bulk),
    0,
    'future_potential and loss_due_timing are not outcomes either'
  );

  -- "missing tracking data": a never-emailed client still gets its row, null-attributed.
  perform tests.status_as(v_cam_a, v_never_sent, 'no_response');

  return next is(
    (select (n, message_ids) from tests.outcomes_of(v_never_sent, 'no_response')),
    (1::bigint, array[null::uuid]),
    'a never-emailed client records its no_response with a null message attribution'
  );

  -- Bulk path labels each moved client.
  return next is(
    tests.sqlstate_of(v_cam_a, format(
      'select public.set_outreach_status_bulk(array[%L]::uuid[], ''soft_no''::public.outreach_status)',
      v_bulk)),
    null,
    'a bulk move onto a terminal status succeeds'
  );

  return next is(
    (select n from tests.outcomes_of(v_bulk, 'soft_no')),
    1::bigint,
    'the bulk move recorded the outcome for the batch member'
  );

  -- A refused batch applies nothing, including its labelling.
  return next is(
    tests.sqlstate_of(v_cam_b, format(
      'select public.set_outreach_status(%L, ''hard_no''::public.outreach_status)',
      v_bulk)),
    '42501',
    'another CAM''s client is refused'
  );

  return next ok(
    (select count(*)::int from public.outcomes where organisation_id = v_bulk) = 1,
    'the refused call wrote nothing extra'
  );

  -- The old value names are gone at the type level — there is no code path that
  -- could accept one, through the policies or otherwise.
  return next is(
    tests.sqlstate_of(v_admin, format(
      'insert into public.outcomes (organisation_id, outcome_type, recorded_by_user_id) '
      'values (%L, ''referral'', %L)',
      v_bulk, v_admin)),
    '22P02',
    'a removed taxonomy value is rejected by the enum itself'
  );
end;
$$;

select tests.suite_email_outcome();

select * from finish();
rollback;
