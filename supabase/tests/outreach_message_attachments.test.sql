-- F217 (#212) Attach File to Email — attach_file_to_draft / detach_file_from_draft.
-- Run by `supabase test db`.
--
-- Like discard_outreach_draft.test.sql, these run as real end-user roles,
-- never as service_role or the owning role: both RPCs are SECURITY DEFINER,
-- so testing as a superuser would exercise a path no user can reach.

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

create or replace function tests.rows_affected(p_user_id uuid, p_sql text)
returns int language plpgsql as $$
declare v_count int;
begin
  perform tests.login_as(p_user_id);
  execute p_sql;
  get diagnostics v_count = row_count;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function tests.seed_draft_attachments()
returns void language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a217-000000000001';
  v_cam_a uuid := '00000000-0000-4000-a217-000000000002';
  v_cam_b uuid := '00000000-0000-4000-a217-000000000003';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-217@180dc.org'),
    (v_cam_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-a-217@180dc.org'),
    (v_cam_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam-b-217@180dc.org')
  on conflict (id) do nothing;

  insert into public.users (id, email, full_name, role, is_active)
  values
    (v_admin, 'admin-217@180dc.org', 'Test Admin 217', 'admin', true),
    (v_cam_a, 'cam-a-217@180dc.org', 'Test CAM A217', 'cam', true),
    (v_cam_b, 'cam-b-217@180dc.org', 'Test CAM B217', 'cam', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

  insert into public.organisations (id, legal_name, entry_method, organisation_type, owner_id)
  values
    ('00000000-0000-4000-c217-000000000001', 'CAM A Client 217', 'manual', 'other', v_cam_a),
    ('00000000-0000-4000-c217-000000000002', 'CAM B Client 217', 'manual', 'other', v_cam_b);

  insert into public.outreach_messages (id, organisation_id, sent_by_user_id, subject, body, send_status, sent_at)
  values
    ('00000000-0000-4000-d217-000000000001', '00000000-0000-4000-c217-000000000001', v_cam_a, 'Draft A', 'Body', 'draft', null),
    ('00000000-0000-4000-d217-000000000002', '00000000-0000-4000-c217-000000000002', v_cam_b, 'Draft B', 'Body', 'draft', null),
    ('00000000-0000-4000-d217-000000000003', '00000000-0000-4000-c217-000000000001', v_cam_a, 'Already sent', 'Body', 'sent', now());

  insert into public.attachments (id, organisation_id, filename, storage_path, content_type, size_bytes, uploaded_by)
  values
    ('00000000-0000-4000-e217-000000000001', '00000000-0000-4000-c217-000000000001', 'agreement.pdf', '00000000-0000-4000-c217-000000000001/agreement.pdf', 'application/pdf', 1000, v_cam_a),
    ('00000000-0000-4000-e217-000000000002', '00000000-0000-4000-c217-000000000002', 'other-client-file.pdf', '00000000-0000-4000-c217-000000000002/other-client-file.pdf', 'application/pdf', 1000, v_cam_b);
end;
$$;

-- ---------------------------------------------------------------------------
-- Suite
-- ---------------------------------------------------------------------------

create or replace function tests.suite_draft_attachments()
returns setof text language plpgsql as $$
declare
  v_admin uuid := '00000000-0000-4000-a217-000000000001';
  v_cam_a uuid := '00000000-0000-4000-a217-000000000002';
  v_cam_b uuid := '00000000-0000-4000-a217-000000000003';
  v_draft_a uuid := '00000000-0000-4000-d217-000000000001';
  v_draft_b uuid := '00000000-0000-4000-d217-000000000002';
  v_already_sent uuid := '00000000-0000-4000-d217-000000000003';
  v_missing uuid := '00000000-0000-4000-d217-000000000099';
  v_attachment_a uuid := '00000000-0000-4000-e217-000000000001';
  v_attachment_b uuid := '00000000-0000-4000-e217-000000000002';
  v_count integer;
begin
  if to_regprocedure('public.attach_file_to_draft(uuid,uuid)') is null
     or to_regprocedure('public.detach_file_from_draft(uuid,uuid)') is null then
    return next skip(1, 'F217 attach/detach functions not yet migrated');
    return;
  end if;

  perform tests.seed_draft_attachments();

  -- --- Direct table access: no write grant to authenticated at all ----------

  return next is(
    tests.sqlstate_of(
      v_cam_a,
      format('insert into public.outreach_message_attachments (outreach_message_id, attachment_id) values (%L, %L)', v_draft_a, v_attachment_a)
    ),
    '42501',
    'authenticated has no direct INSERT grant on the link table'
  );

  -- --- attach_file_to_draft: ownership ---------------------------------------

  return next is(
    tests.sqlstate_of(v_cam_b, format('select public.attach_file_to_draft(%L, %L)', v_draft_a, v_attachment_a)),
    '42501',
    'a CAM cannot attach a file to another CAM''s draft'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.attach_file_to_draft(%L, %L)', v_draft_a, v_attachment_a)),
    null,
    'the draft''s own owner can attach a file'
  );
  return next is(
    (select count(*) from public.outreach_message_attachments where outreach_message_id = v_draft_a),
    1::bigint,
    'the link row was actually written'
  );

  return next is(
    tests.sqlstate_of(v_admin, format('select public.attach_file_to_draft(%L, %L)', v_draft_b, v_attachment_b)),
    null,
    'an admin can attach a file to any CAM''s draft'
  );

  -- --- attach_file_to_draft: draft status and cross-client checks -----------

  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.attach_file_to_draft(%L, %L)', v_already_sent, v_attachment_a)),
    'P0002',
    'a file cannot be attached to an already-sent message'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.attach_file_to_draft(%L, %L)', v_draft_a, v_attachment_b)),
    '22023',
    'a file belonging to a different client cannot be attached'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.attach_file_to_draft(%L, %L)', v_missing, v_attachment_a)),
    'P0002',
    'attaching to a nonexistent draft is refused'
  );

  -- --- attach_file_to_draft: idempotent, not an error ------------------------

  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.attach_file_to_draft(%L, %L)', v_draft_a, v_attachment_a)),
    null,
    'attaching the same file twice is a no-op, not an error'
  );
  return next is(
    (select count(*) from public.outreach_message_attachments where outreach_message_id = v_draft_a),
    1::bigint,
    'the no-op did not create a duplicate row'
  );

  -- --- attach_file_to_draft: count and combined-size caps --------------------

  -- Ten more attachments to push v_draft_a to the 10-item cap (it already has
  -- one from above).
  insert into public.attachments (id, organisation_id, filename, storage_path, content_type, size_bytes, uploaded_by)
  select
    ('00000000-0000-4000-e217-0000000001' || lpad(n::text, 2, '0'))::uuid,
    '00000000-0000-4000-c217-000000000001',
    'file' || n || '.pdf',
    '00000000-0000-4000-c217-000000000001/file' || n || '.pdf',
    'application/pdf',
    100,
    v_cam_a
  from generate_series(10, 18) as n;

  perform tests.login_as(v_cam_a);
  for v_count in select n from generate_series(10, 18) as n loop
    perform public.attach_file_to_draft(v_draft_a, ('00000000-0000-4000-e217-0000000001' || lpad(v_count::text, 2, '0'))::uuid);
  end loop;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  return next is(
    (select count(*) from public.outreach_message_attachments where outreach_message_id = v_draft_a),
    10::bigint,
    'the draft now sits at the 10-attachment cap'
  );

  insert into public.attachments (id, organisation_id, filename, storage_path, content_type, size_bytes, uploaded_by)
  values ('00000000-0000-4000-e217-000000000099', '00000000-0000-4000-c217-000000000001', 'eleventh.pdf', '00000000-0000-4000-c217-000000000001/eleventh.pdf', 'application/pdf', 1, v_cam_a);

  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.attach_file_to_draft(%L, %L)', v_draft_a, '00000000-0000-4000-e217-000000000099'::uuid)),
    '23514',
    'an 11th attachment is refused (count cap)'
  );

  insert into public.attachments (id, organisation_id, filename, storage_path, content_type, size_bytes, uploaded_by)
  values ('00000000-0000-4000-e217-000000000098', '00000000-0000-4000-c217-000000000002', 'huge.pdf', '00000000-0000-4000-c217-000000000002/huge.pdf', 'application/pdf', 19000000, v_cam_b);

  return next is(
    tests.sqlstate_of(v_cam_b, format('select public.attach_file_to_draft(%L, %L)', v_draft_b, '00000000-0000-4000-e217-000000000098'::uuid)),
    '23514',
    'a single file over the 18MB combined cap is refused'
  );

  -- --- detach_file_from_draft --------------------------------------------

  return next is(
    tests.sqlstate_of(v_cam_b, format('select public.detach_file_from_draft(%L, %L)', v_draft_a, v_attachment_a)),
    '42501',
    'a CAM cannot detach a file from another CAM''s draft'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.detach_file_from_draft(%L, %L)', v_draft_a, v_attachment_a)),
    null,
    'the draft''s own owner can detach a file'
  );
  return next is(
    (select count(*) from public.outreach_message_attachments where outreach_message_id = v_draft_a and attachment_id = v_attachment_a),
    0::bigint,
    'the link row was actually removed'
  );

  return next is(
    tests.sqlstate_of(v_cam_a, format('select public.detach_file_from_draft(%L, %L)', v_draft_a, v_attachment_a)),
    null,
    'detaching something already detached is a no-op, not an error'
  );

  -- --- Cascade behaviour ------------------------------------------------

  return next ok(
    (select count(*) > 0 from public.outreach_message_attachments where outreach_message_id = v_draft_b),
    'sanity: draft B still has its linked attachment before the cascade check'
  );
  delete from public.attachments where id = v_attachment_b;
  return next is(
    (select count(*) from public.outreach_message_attachments where attachment_id = v_attachment_b),
    0::bigint,
    'deleting an attachment cascades to its link rows'
  );

  return next ok(
    (select count(*) > 0 from public.outreach_message_attachments where outreach_message_id = v_draft_a),
    'sanity: draft A still has linked attachments before the cascade check'
  );
  delete from public.outreach_messages where id = v_draft_a;
  return next is(
    (select count(*) from public.outreach_message_attachments where outreach_message_id = v_draft_a),
    0::bigint,
    'deleting a draft cascades to its link rows'
  );
end;
$$;

select * from tests.suite_draft_attachments();

select * from finish();

rollback;
