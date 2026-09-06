-- F154 AC3 (#149) — No Response Status, automatic transition. Run with
-- `supabase test db`.
--
-- Covers public.mark_organisation_no_response (the per-client guarded
-- transition) and public.sweep_no_response_status (the daily sweep that
-- finds and transitions every eligible client).

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

create schema if not exists tests;

-- Fixtures below are split by phase: the direct-call tests use their own
-- dedicated orgs so a manual transition never contaminates the sweep
-- assertions that run afterwards against a disjoint set of orgs.
create or replace function tests.seed_no_response()
returns void language plpgsql as $$
declare
  v_cam_a uuid := '00000000-0000-4000-a154-000000000001';
  v_cam_b uuid := '00000000-0000-4000-a154-000000000002';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_cam_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a-154@180dc.org'),
    (v_cam_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b-154@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_cam_a, 'cam-a-154@180dc.org', 'Test CAM A154', 'cam', true),
    (v_cam_b, 'cam-b-154@180dc.org', 'Test CAM B154', 'cam', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

  -- CAM A keeps the platform default (no preferences row).
  -- CAM B sets a short 3-day second threshold.
  insert into public.outreach_preferences (user_id, second_follow_up_days)
  values (v_cam_b, 3)
  on conflict (user_id) do update set second_follow_up_days = excluded.second_follow_up_days;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status)
  values
    -- Direct-call fixtures, exercised only by mark_organisation_no_response
    -- itself and never touched by the sweep below.
    ('00000000-0000-4000-c154-000000000101', 'Direct Target Client', 'manual', 'other', v_cam_a, 'follow_up_sent'),
    ('00000000-0000-4000-c154-000000000102', 'Direct Responded Client', 'manual', 'other', v_cam_a, 'responded'),
    ('00000000-0000-4000-c154-000000000103', 'Direct Hard No Client', 'manual', 'other', v_cam_a, 'hard_no'),

    -- Sweep fixtures.
    -- Silent well past the 14-day default, owned by CAM A: should transition.
    ('00000000-0000-4000-c154-000000000001', 'Long Silent Client', 'manual', 'other', v_cam_a, 'initial_outreach_sent'),
    -- Sent 5 days ago, owned by CAM A (14-day default): should NOT transition yet.
    ('00000000-0000-4000-c154-000000000002', 'Recent Client', 'manual', 'other', v_cam_a, 'follow_up_sent'),
    -- Sent 5 days ago, owned by CAM B (3-day threshold): should transition.
    ('00000000-0000-4000-c154-000000000003', 'Short Window Client', 'manual', 'other', v_cam_b, 'initial_outreach_sent'),
    -- Long silent but already responded: must never be touched by the sweep.
    ('00000000-0000-4000-c154-000000000004', 'Already Responded Client', 'manual', 'other', v_cam_a, 'responded'),
    -- Long silent but a CAM already made a final call: must never be touched.
    ('00000000-0000-4000-c154-000000000005', 'Hard No Client', 'manual', 'other', v_cam_a, 'hard_no'),
    -- No activity recorded at all: cannot be measured, must be skipped.
    ('00000000-0000-4000-c154-000000000006', 'No Activity Client', 'manual', 'other', v_cam_a, 'initial_outreach_sent');

  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, sent_at)
  values
    ('00000000-0000-4000-d154-000000000001', '00000000-0000-4000-c154-000000000001', v_cam_a, 'Hi', 'Body', 'sent', now() - interval '20 days'),
    ('00000000-0000-4000-d154-000000000002', '00000000-0000-4000-c154-000000000002', v_cam_a, 'Hi', 'Body', 'sent', now() - interval '5 days'),
    ('00000000-0000-4000-d154-000000000003', '00000000-0000-4000-c154-000000000003', v_cam_b, 'Hi', 'Body', 'sent', now() - interval '5 days'),
    ('00000000-0000-4000-d154-000000000004', '00000000-0000-4000-c154-000000000004', v_cam_a, 'Hi', 'Body', 'sent', now() - interval '20 days'),
    ('00000000-0000-4000-d154-000000000005', '00000000-0000-4000-c154-000000000005', v_cam_a, 'Hi', 'Body', 'sent', now() - interval '20 days');
end;
$$;

create or replace function tests.suite_no_response()
returns setof text language plpgsql as $$
declare
  v_direct_target uuid := '00000000-0000-4000-c154-000000000101';
  v_direct_responded uuid := '00000000-0000-4000-c154-000000000102';
  v_direct_hard_no uuid := '00000000-0000-4000-c154-000000000103';
  v_long_silent uuid := '00000000-0000-4000-c154-000000000001';
  v_recent uuid := '00000000-0000-4000-c154-000000000002';
  v_short_window uuid := '00000000-0000-4000-c154-000000000003';
  v_already_responded uuid := '00000000-0000-4000-c154-000000000004';
  v_hard_no uuid := '00000000-0000-4000-c154-000000000005';
  v_no_activity uuid := '00000000-0000-4000-c154-000000000006';
  v_transitioned integer;
begin
  if to_regprocedure('public.mark_organisation_no_response(uuid)') is null
     or to_regprocedure('public.sweep_no_response_status()') is null then
    return next skip(1, 'F154 AC3 functions not yet migrated');
    return;
  end if;

  return next ok(
    not has_function_privilege('authenticated', 'public.mark_organisation_no_response(uuid)', 'execute'),
    'authenticated users cannot call mark_organisation_no_response directly'
  );
  return next ok(
    not has_function_privilege('authenticated', 'public.sweep_no_response_status()', 'execute'),
    'authenticated users cannot trigger the sweep directly'
  );

  perform tests.seed_no_response();

  -- mark_organisation_no_response: the guarded per-client transition.
  return next is(
    public.mark_organisation_no_response(v_direct_target),
    true,
    'transitions a client sitting at follow_up_sent'
  );
  return next is(
    (select outreach_status::text from public.organisations where id = v_direct_target),
    'no_response',
    'the status is actually written'
  );
  return next is(
    (select count(*) from public.audit_log where action = 'status_changed' and target_id = v_direct_target and detail ->> 'trigger' = 'silence_window_elapsed'),
    1::bigint,
    'the transition is audited with the silence trigger'
  );

  return next is(
    public.mark_organisation_no_response(v_direct_responded),
    false,
    'refuses to transition a client already marked responded'
  );
  return next is(
    (select outreach_status::text from public.organisations where id = v_direct_responded),
    'responded',
    'the responded status is left untouched'
  );

  return next is(
    public.mark_organisation_no_response(v_direct_hard_no),
    false,
    'refuses to override a CAM''s manual final decision (hard_no)'
  );

  -- sweep_no_response_status: the daily batch, run against the disjoint sweep
  -- fixtures — none of these were touched by the direct-call tests above.
  v_transitioned := public.sweep_no_response_status();

  return next is(
    (select outreach_status::text from public.organisations where id = v_long_silent),
    'no_response',
    'sweep transitions a client silent well past the 14-day default'
  );
  return next is(
    (select outreach_status::text from public.organisations where id = v_recent),
    'follow_up_sent',
    'sweep leaves a client within its owner''s default window untouched'
  );
  return next is(
    (select outreach_status::text from public.organisations where id = v_short_window),
    'no_response',
    'sweep honours a shorter per-owner second_follow_up_days threshold'
  );
  return next is(
    (select outreach_status::text from public.organisations where id = v_already_responded),
    'responded',
    'sweep never touches a client outside initial_outreach_sent/follow_up_sent'
  );
  return next is(
    (select outreach_status::text from public.organisations where id = v_hard_no),
    'hard_no',
    'sweep never overrides a manual final decision'
  );
  return next is(
    (select outreach_status::text from public.organisations where id = v_no_activity),
    'initial_outreach_sent',
    'sweep skips a client with no measurable activity rather than guessing'
  );
  return next is(
    v_transitioned,
    2,
    'sweep returns the count of clients actually transitioned'
  );

  return next is(
    (select count(*) from public.audit_log where action = 'status_changed' and target_id = v_long_silent and detail ->> 'trigger' = 'silence_window_elapsed'),
    1::bigint,
    'each sweep transition is individually audited'
  );

  -- Idempotency: running the sweep again with nothing further to move must
  -- not re-transition or re-audit anything.
  return next is(
    public.sweep_no_response_status(),
    0,
    'a second sweep with no newly-eligible clients transitions nothing'
  );
  return next is(
    (select count(*) from public.audit_log where action = 'status_changed' and target_id = v_long_silent),
    1::bigint,
    'a second sweep does not write a duplicate audit row'
  );
end;
$$;

select * from tests.suite_no_response();

select * from finish();

rollback;
