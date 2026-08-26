-- Training dataset view tests — F098 (#97)
-- Spec: 20260912120000_create_training_examples_view.sql. Run by `supabase test db`.
--
-- The three properties worth a database test:
--   1. The join is deterministic — one row per scored attempt, carrying its
--      label and metadata (latest of each).
--   2. Privacy is an ALLOWLIST: the view's column set is asserted exactly, so
--      a column added to the view without a test edit fails here. This is the
--      AC3 proof — no personal-data-bearing column can slip in quietly.
--   3. Admin-only by construction: security_invoker means a CAM's SELECT hits
--      SCORE_SNAPSHOTS' admin-only RLS and returns empty, never rows.
--
-- Harness copied from score_snapshots.test.sql.

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

create or replace function tests.text_as(p_user_id uuid, p_sql text)
returns text language plpgsql as $$
declare v_result text;
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

create or replace function tests.seed_training()
returns void language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_cam   uuid := '00000000-0000-4000-a000-000000000002';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@180dc.org'),
    (v_cam,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin, 'admin@180dc.org', 'Test Admin', 'admin', true),
    (v_cam,   'cam@180dc.org',   'Test CAM',   'cam',   true)
  on conflict (id) do update
    set role = excluded.role, is_active = excluded.is_active;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id, outreach_status, sector)
  values ('00000000-0000-4000-c000-000000000001', 'Training Client', 'manual', 'charity', v_cam, 'converted', 'environment');

  -- Three sent messages with snapshots: one converted (two outcomes — latest
  -- must win), one labelled reply, one still unlabelled.
  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, sent_at, sent_to_email)
  values
    ('00000000-0000-4000-d000-000000000201', '00000000-0000-4000-c000-000000000001', v_cam, 'S1', 'B1', 'sent', '2026-09-12T09:00:00Z', 'person@example.org'),
    ('00000000-0000-4000-d000-000000000202', '00000000-0000-4000-c000-000000000001', v_cam, 'S2', 'B2', 'sent', '2026-09-12T10:00:00Z', 'person@example.org'),
    ('00000000-0000-4000-d000-000000000203', '00000000-0000-4000-c000-000000000001', v_cam, 'S3', 'B3', 'sent', '2026-09-12T11:00:00Z', 'person@example.org');

  insert into public.score_snapshots (
    outreach_message_id, organisation_id,
    sector, geography, size, partnership_history, previous_contact,
    priority_score, priority_band, model_version_id
  )
  select m.id, m.organisation_id, 0.5, 0.5, 0.7, 0.1, 0.9, 0.55, 'medium', null
    from public.outreach_messages m
   where m.organisation_id = '00000000-0000-4000-c000-000000000001';

  insert into public.ai_generations (outreach_message_id, generated_subject, generated_body, cam_edited, edit_distance, model, prompt_system, prompt_user, created_at)
  values
    ('00000000-0000-4000-d000-000000000201', 'gen', 'gen', true, 120, 'gemini-test', 'sys', 'usr', '2026-09-12T08:00:00Z'),
    ('00000000-0000-4000-d000-000000000201', 'gen', 'gen', false, 0, 'gemini-test', 'sys', 'usr', '2026-09-12T08:30:00Z'); -- later wins

  insert into public.outcomes (organisation_id, outreach_message_id, outcome_type, created_at)
  values
    -- OUTCOMES mirrors current state: at most one row per (client, type).
    ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-d000-000000000201', 'reply',    '2026-09-13T09:00:00Z'),
    ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-d000-000000000201', 'soft_no',  '2026-09-14T09:00:00Z'), -- latest wins
    ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-d000-000000000202', 'converted','2026-09-13T10:00:00Z');
end;
$$;

select tests.seed_training();

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------

-- One row per scored attempt, exactly.
select is(
  (select count(*) from public.training_examples),
  3::bigint,
  'one row per score snapshot'
);

-- Label join takes the LATEST outcome per message.
select is(
  (select outcome_label from public.training_examples where outreach_message_id = '00000000-0000-4000-d000-000000000201'),
  'soft_no',
  'the label is the message''s latest outcome'
);

select is(
  (select outcome_label from public.training_examples where outreach_message_id = '00000000-0000-4000-d000-000000000203'),
  null,
  'an attempt without an outcome appears with a null label'
);

select is(
  (select count(*) from public.training_examples where outcome_label is null),
  1::bigint,
  'the funnel shows unlabelled attempts rather than dropping them'
);

-- Metadata join takes the LATEST generation per message.
select is(
  (select cam_edited from public.training_examples where outreach_message_id = '00000000-0000-4000-d000-000000000201'),
  false,
  'email metadata reflects the latest AI generation'
);

select is(
  (select organisation_sector from public.training_examples limit 1),
  'environment',
  'the org sector attribute rides along'
);

-- PRIVACY ALLOWLIST (AC3): these columns, and ONLY these, may exist. Every
-- entry is an id, a 0-1 number, an enum token, a derived fact, or a timestamp
-- — no subject/body/recipient/notes/reply text can appear without editing
-- this test, which is the point.
select is(
  (
    select string_agg(column_name, ',' order by column_name)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'training_examples'
  ),
  'cam_edited,edit_distance,generation_model,geography,model_version_id,organisation_id,organisation_sector,outcome_label,outcome_recorded_at,outreach_message_id,partnership_history,previous_contact,priority_band,priority_score,sector,sent_at,size,snapshot_scored_at',
  'the view exposes exactly the non-personal allowlist'
);

-- Admin-only BY CONSTRUCTION (security_invoker): a CAM's SELECT passes
-- through to SCORE_SNAPSHOTS' admin-only RLS and returns empty — silently,
-- like querying that table directly.
select is(
  tests.bool_as(
    '00000000-0000-4000-a000-000000000002',
    'select (select count(*) from public.training_examples) = 0'
  ),
  true,
  'a CAM''s view of the training dataset is empty'
);

select is(
  tests.bool_as(
    '00000000-0000-4000-a000-000000000001',
    'select (select count(*) from public.training_examples) > 0'
  ),
  true,
  'an admin reads the training dataset through the same view'
);

select * from finish();
rollback;
