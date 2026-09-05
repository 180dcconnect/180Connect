-- F133 Reply Notification database contract. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-a133-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-f133@180dc.org'),
  ('00000000-0000-4000-a133-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a-f133@180dc.org'),
  ('00000000-0000-4000-a133-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b-f133@180dc.org')
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, is_active)
values
  ('00000000-0000-4000-a133-000000000001', 'owner-f133@180dc.org', 'F133 Owner', 'cam', true),
  ('00000000-0000-4000-a133-000000000002', 'admin-a-f133@180dc.org', 'F133 Admin A', 'admin', true),
  ('00000000-0000-4000-a133-000000000003', 'admin-b-f133@180dc.org', 'F133 Admin B', 'admin', true)
on conflict (id) do update set role = excluded.role, is_active = true;

insert into public.organisations (id, legal_name, entry_method, organisation_type, outreach_status, owner_id)
values
  ('00000000-0000-4000-c133-000000000001', 'Owned F133 Charity', 'manual', 'charity', 'initial_outreach_sent', '00000000-0000-4000-a133-000000000001'),
  ('00000000-0000-4000-c133-000000000002', 'Unowned F133 Charity', 'manual', 'charity', 'initial_outreach_sent', null);

insert into public.outreach_messages (id, organisation_id, subject, body, send_status, sent_at)
values
  ('00000000-0000-4000-d133-000000000001', '00000000-0000-4000-c133-000000000001', 'Owned hello', 'Hello', 'sent', now()),
  ('00000000-0000-4000-d133-000000000002', '00000000-0000-4000-c133-000000000002', 'Unowned hello', 'Hello', 'sent', now());

select isnt(public.capture_gmail_reply(
  'gmail-f133-owned', '00000000-0000-4000-d133-000000000001',
  '00000000-0000-4000-c133-000000000001', 'Yes, please call.', now(), 'owned@example.org'
), null, 'owned client reply is captured');

select is((select count(*) from public.notifications where target_table = 'reply_events' and recipient_user_id = '00000000-0000-4000-a133-000000000001'), 1::bigint, 'active owner receives one notification');
select is((select count(*) from public.notifications where target_table = 'reply_events' and recipient_user_id in ('00000000-0000-4000-a133-000000000002', '00000000-0000-4000-a133-000000000003')), 0::bigint, 'admins are not notified for an owned client');
select is((select link_path from public.notifications where recipient_user_id = '00000000-0000-4000-a133-000000000001'), '/clients/00000000-0000-4000-c133-000000000001#timeline-heading', 'notification links directly to the client timeline');

select isnt(public.capture_gmail_reply(
  'gmail-f133-unowned', '00000000-0000-4000-d133-000000000002',
  '00000000-0000-4000-c133-000000000002', 'Can you send more information?', now(), 'unowned@example.org'
), null, 'unowned client reply is captured');

select is((select count(*) from public.notifications where notification_type = 'unowned_client_reply_received' and recipient_user_id = '00000000-0000-4000-a133-000000000002'), 1::bigint, 'first active admin receives the unowned-client fallback');
select is((select count(*) from public.notifications where notification_type = 'unowned_client_reply_received' and recipient_user_id = '00000000-0000-4000-a133-000000000003'), 1::bigint, 'second active admin receives the unowned-client fallback');

select is(public.capture_gmail_reply(
  'gmail-f133-owned', '00000000-0000-4000-d133-000000000001',
  '00000000-0000-4000-c133-000000000001', 'Yes, please call.', now(), 'owned@example.org'
), null, 'duplicate reply is a no-op');

select is((select count(*) from public.notifications where recipient_user_id = '00000000-0000-4000-a133-000000000001' and target_table = 'reply_events'), 1::bigint, 'duplicate reply creates no duplicate notification');

select * from finish();
rollback;
