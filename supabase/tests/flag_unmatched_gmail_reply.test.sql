-- F132 unmatched-reply review contract. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.flag_unmatched_gmail_reply(text,text,text,text,text,timestamptz)',
    'execute'
  ),
  'authenticated users cannot forge unmatched reply flags'
);

select isnt(
  public.flag_unmatched_gmail_reply(
    'gmail-unmatched-f132-1', 'thread-unknown', 'hello@example.org',
    'Re: Introduction', 'Could someone call me?', '2026-08-26T10:00:00Z'
  ),
  null,
  'an unmatched reply is flagged for review'
);

select is(
  (select count(*) from public.audit_log
    where action = 'gmail_reply_needs_review'
      and detail ->> 'provider_message_id' = 'gmail-unmatched-f132-1'),
  1::bigint,
  'one review item is retained'
);

select is(
  public.flag_unmatched_gmail_reply(
    'gmail-unmatched-f132-1', 'thread-unknown', 'hello@example.org',
    'Re: Introduction', 'Could someone call me?', '2026-08-26T10:00:00Z'
  ),
  null,
  'a duplicate unmatched Gmail message is a no-op'
);

select is(
  (select count(*) from public.audit_log
    where action = 'gmail_reply_needs_review'
      and detail ->> 'provider_message_id' = 'gmail-unmatched-f132-1'),
  1::bigint,
  'the duplicate creates no second review item'
);

select * from finish();
rollback;
