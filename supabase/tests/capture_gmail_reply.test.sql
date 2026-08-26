-- F131 Detect Replies database contract. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

select * from finish();
rollback;
