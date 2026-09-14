-- Former-owner notification on ownership change. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-a0c0-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a-ownchg@180dc.org'),
  ('00000000-0000-4000-a0c0-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-ownchg@180dc.org'),
  ('00000000-0000-4000-a0c0-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gone-ownchg@180dc.org')
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, is_active)
values
  ('00000000-0000-4000-a0c0-000000000001', 'owner-a-ownchg@180dc.org', 'Ownchg Owner', 'cam', true),
  ('00000000-0000-4000-a0c0-000000000002', 'admin-ownchg@180dc.org', 'Ownchg Admin', 'admin', true),
  ('00000000-0000-4000-a0c0-000000000003', 'gone-ownchg@180dc.org', 'Ownchg Gone', 'cam', false)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

insert into public.organisations (id, legal_name, entry_method, organisation_type, outreach_status, owner_id)
values
  ('00000000-0000-4000-c0c0-000000000001', 'Ownchg Taken Charity', 'manual', 'charity', 'initial_outreach_sent', '00000000-0000-4000-a0c0-000000000001'),
  ('00000000-0000-4000-c0c0-000000000002', 'Ownchg Inactive Charity', 'manual', 'charity', 'initial_outreach_sent', '00000000-0000-4000-a0c0-000000000003'),
  ('00000000-0000-4000-c0c0-000000000003', 'Ownchg Unowned Charity', 'manual', 'charity', 'initial_outreach_sent', null);

-- Admin takes a CAM's client (the inbox banner's call).
select tests.login_as('00000000-0000-4000-a0c0-000000000002');
select is(
  (public.reassign_ownership(
    array['00000000-0000-4000-c0c0-000000000001']::uuid[],
    '00000000-0000-4000-a0c0-000000000002',
    'Taken over from the inbox to reply to the client',
    '00000000-0000-4000-a0c0-000000000001'
  ) ->> 'organisations_moved')::int,
  1,
  'admin moves the client to themselves'
);
reset role;

select is(
  (select count(*) from public.notifications
    where recipient_user_id = '00000000-0000-4000-a0c0-000000000001'
      and notification_type = 'client_ownership_changed'),
  1::bigint,
  'former owner receives one ownership-change notification'
);
select is(
  (select title from public.notifications
    where recipient_user_id = '00000000-0000-4000-a0c0-000000000001'
      and notification_type = 'client_ownership_changed'),
  'Ownchg Taken Charity is no longer your client',
  'title names the client'
);
select is(
  (select link_path from public.notifications
    where recipient_user_id = '00000000-0000-4000-a0c0-000000000001'
      and notification_type = 'client_ownership_changed'),
  '/clients/00000000-0000-4000-c0c0-000000000001',
  'notification links to the client record'
);
select is(
  (select actor_user_id from public.notifications
    where recipient_user_id = '00000000-0000-4000-a0c0-000000000001'
      and notification_type = 'client_ownership_changed'),
  '00000000-0000-4000-a0c0-000000000002'::uuid,
  'the admin is recorded as the actor'
);
select is(
  (select count(*) from public.notifications
    where recipient_user_id = '00000000-0000-4000-a0c0-000000000002'
      and notification_type = 'client_ownership_changed'),
  0::bigint,
  'the admin who took the client is not notified'
);

-- A deactivated former owner (offboarding) is not notified.
select tests.login_as('00000000-0000-4000-a0c0-000000000002');
select public.reassign_ownership(
  array['00000000-0000-4000-c0c0-000000000002']::uuid[],
  '00000000-0000-4000-a0c0-000000000001',
  'Offboarding handover',
  '00000000-0000-4000-a0c0-000000000003'
);
reset role;
select is(
  (select count(*) from public.notifications
    where recipient_user_id = '00000000-0000-4000-a0c0-000000000003'),
  0::bigint,
  'a deactivated former owner is not notified'
);

-- Assigning a previously unowned client tells nobody.
select tests.login_as('00000000-0000-4000-a0c0-000000000002');
select public.reassign_ownership(
  array['00000000-0000-4000-c0c0-000000000003']::uuid[],
  '00000000-0000-4000-a0c0-000000000001',
  'Assigning an unowned client',
  null
);
reset role;
select is(
  (select count(*) from public.notifications
    where target_id = '00000000-0000-4000-c0c0-000000000003'
      and notification_type = 'client_ownership_changed'),
  0::bigint,
  'assigning an unowned client creates no ownership-change notification'
);

select * from finish();
rollback;
