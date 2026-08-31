-- F139 response-time storage contract. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.organisations (id, legal_name, entry_method, organisation_type)
values ('00000000-0000-4000-c139-000000000001', 'F139 Test Charity', 'manual', 'charity');

insert into public.outreach_messages
  (id, organisation_id, subject, body, send_status, sent_at)
values
  ('00000000-0000-4000-d139-000000000001', '00000000-0000-4000-c139-000000000001', 'Round one', 'Hello', 'sent', '2026-08-01T09:00:00Z'),
  ('00000000-0000-4000-d139-000000000002', '00000000-0000-4000-c139-000000000001', 'Round two', 'Hello again', 'sent', '2026-08-10T09:00:00Z');

insert into public.reply_events
  (id, outreach_message_id, organisation_id, reply_body, received_at)
values
  ('00000000-0000-4000-e139-000000000001', '00000000-0000-4000-d139-000000000001', '00000000-0000-4000-c139-000000000001', 'First reply', '2026-08-01T10:00:00Z'),
  ('00000000-0000-4000-e139-000000000002', '00000000-0000-4000-d139-000000000001', '00000000-0000-4000-c139-000000000001', 'Later reply', '2026-08-01T11:00:00Z'),
  ('00000000-0000-4000-e139-000000000003', '00000000-0000-4000-d139-000000000002', '00000000-0000-4000-c139-000000000001', 'Second round reply', '2026-08-10T09:30:00Z');

select is(
  (select response_time_seconds from public.reply_events where id = '00000000-0000-4000-e139-000000000001'),
  3600::bigint,
  'the first reply stores elapsed seconds from sent_at'
);
select is(
  (select response_time_seconds from public.reply_events where id = '00000000-0000-4000-e139-000000000002'),
  null::bigint,
  'later back-and-forth replies do not create another attempt metric'
);
select is(
  (select response_time_seconds from public.reply_events where id = '00000000-0000-4000-e139-000000000003'),
  1800::bigint,
  'a later outreach attempt stores its own response time'
);
-- A late-arriving earlier Gmail event becomes the true first response.
insert into public.reply_events
  (id, outreach_message_id, organisation_id, reply_body, received_at)
values
  ('00000000-0000-4000-e139-000000000005', '00000000-0000-4000-d139-000000000001', '00000000-0000-4000-c139-000000000001', 'Actually first', '2026-08-01T09:15:00Z');

select is(
  (select response_time_seconds from public.reply_events where id = '00000000-0000-4000-e139-000000000005'),
  900::bigint,
  'an out-of-order earlier reply receives the metric'
);
select is(
  (select response_time_seconds from public.reply_events where id = '00000000-0000-4000-e139-000000000001'),
  null::bigint,
  'the superseded reply no longer carries the attempt metric'
);
select is(
  (select count(*) from public.reply_events where response_time_seconds is not null),
  2::bigint,
  'exactly one response time is stored per outreach attempt'
);
select throws_ok(
  $$update public.reply_events set response_time_seconds = -1 where id = '00000000-0000-4000-e139-000000000005'$$,
  '23514',
  null,
  'negative response times are rejected'
);

select * from finish();
rollback;
