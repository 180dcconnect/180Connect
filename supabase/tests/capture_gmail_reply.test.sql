-- F131 Detect Replies database contract. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.capture_gmail_reply(text,uuid,uuid,text,timestamptz,text)',
    'execute'
  ),
  'authenticated users cannot forge Gmail reply events'
);

insert into public.organisations (
  id, legal_name, entry_method, organisation_type, outreach_status
) values (
  '00000000-0000-4000-c131-000000000001', 'F131 Test Charity', 'manual', 'charity', 'initial_outreach_sent'
);

insert into public.outreach_messages (
  id, organisation_id, subject, body, send_status, sent_at, sent_to_email
) values (
  '00000000-0000-4000-d131-000000000001',
  '00000000-0000-4000-c131-000000000001',
  'F131 hello', 'Hello', 'sent', now(), 'contact@example.org'
);

select isnt(
  public.capture_gmail_reply(
    'gmail-f131-1',
    '00000000-0000-4000-d131-000000000001',
    '00000000-0000-4000-c131-000000000001',
    'Yes, let us talk.',
    '2026-08-26T10:00:00Z',
    'contact@example.org'
  ),
  null,
  'a matched Gmail reply is captured'
);

select is((select count(*) from public.reply_events where organisation_id = '00000000-0000-4000-c131-000000000001'), 1::bigint, 'one reply event is stored');
select is((select outreach_status::text from public.organisations where id = '00000000-0000-4000-c131-000000000001'), 'responded', 'the client is marked responded');
select is((select count(*) from public.audit_log where action = 'gmail_reply_captured' and detail ->> 'provider_message_id' = 'gmail-f131-1'), 1::bigint, 'capture is audited with the provider id');
select is((select count(*) from public.audit_log where action = 'status_changed' and target_id = '00000000-0000-4000-c131-000000000001'), 1::bigint, 'the automatic status write is audited');

select is(
  public.capture_gmail_reply(
    'gmail-f131-1',
    '00000000-0000-4000-d131-000000000001',
    '00000000-0000-4000-c131-000000000001',
    'Yes, let us talk.',
    '2026-08-26T10:00:00Z',
    'contact@example.org'
  ),
  null,
  'a duplicate provider message is a no-op'
);

select is((select count(*) from public.reply_events where organisation_id = '00000000-0000-4000-c131-000000000001'), 1::bigint, 'the duplicate creates no second timeline event');

-- Two overlapping cron runs can disagree on a match (different sent-outreach
-- snapshots): one flags a reply for review, another later captures it once
-- matched. Capturing must resolve the earlier flag, not leave it looking
-- unresolved in the review queue.
select public.flag_unmatched_gmail_reply(
  'gmail-f131-2', 'thread-2', 'contact@example.org', 'Re: Hello', 'Following up', '2026-08-26T09:00:00Z'
);

insert into public.outreach_messages (
  id, organisation_id, subject, body, send_status, sent_at, sent_to_email
) values (
  '00000000-0000-4000-d131-000000000002',
  '00000000-0000-4000-c131-000000000001',
  'F131 hello 2', 'Hello', 'sent', now(), 'contact@example.org'
);

select isnt(
  public.capture_gmail_reply(
    'gmail-f131-2',
    '00000000-0000-4000-d131-000000000002',
    '00000000-0000-4000-c131-000000000001',
    'Following up',
    '2026-08-26T10:05:00Z',
    'contact@example.org'
  ),
  null,
  'a reply first flagged for review can still be captured once matched'
);

select is(
  (select count(*) from public.audit_log
    where action = 'gmail_reply_review_resolved'
      and detail ->> 'provider_message_id' = 'gmail-f131-2'),
  1::bigint,
  'capturing a previously flagged reply resolves the review flag'
);

-- F149 AC2: a reply arriving for a client a CAM already closed out must not
-- silently reopen it. capture_gmail_reply delegates the transition to
-- mark_organisation_responded (20260912170100), which carries this guarantee.
insert into public.organisations (
  id, legal_name, entry_method, organisation_type, outreach_status
) values (
  '00000000-0000-4000-c131-000000000002', 'F149 Converted Charity', 'manual', 'charity', 'converted'
);

insert into public.outreach_messages (
  id, organisation_id, subject, body, send_status, sent_at, sent_to_email
) values (
  '00000000-0000-4000-d131-000000000003',
  '00000000-0000-4000-c131-000000000002',
  'F149 hello', 'Hello', 'sent', now(), 'contact@already-converted.org'
);

select isnt(
  public.capture_gmail_reply(
    'gmail-f149-1',
    '00000000-0000-4000-d131-000000000003',
    '00000000-0000-4000-c131-000000000002',
    'Thanks again!',
    '2026-08-26T11:00:00Z',
    'contact@already-converted.org'
  ),
  null,
  'a reply is still captured for a client with a final status'
);

select is(
  (select outreach_status::text from public.organisations where id = '00000000-0000-4000-c131-000000000002'),
  'converted',
  'the converted status is not overridden by the reply'
);

select is(
  (select count(*) from public.audit_log
    where action = 'status_changed' and target_id = '00000000-0000-4000-c131-000000000002'),
  0::bigint,
  'no status_changed row is written when the transition is refused'
);

select * from finish();
rollback;
