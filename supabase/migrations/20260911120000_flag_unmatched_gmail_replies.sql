-- Migration: flag_unmatched_gmail_replies
-- Story: F132 Link Reply to Client.
--
-- Unmatched inbound mail cannot be written to REPLY_EVENTS: that approved table
-- requires organisation_id, and inventing one would violate the story. The existing
-- append-only AUDIT_LOG detail jsonb is the approved system-event context store, so
-- an unmatched reply is retained there as a manual-review flag until a dedicated
-- inbox-review entity is added to the Data Model spreadsheet.
--
-- No table/column change: the flexible AUDIT_LOG shape is used as designed. The
-- provider id is deduplicated under an advisory lock, so overlapping cron runs create
-- one review item. Full reply text is retained because the Gmail poll only looks back
-- two days; storing only a pointer could make the item impossible to review later.
--
-- Security: service_role only. AUDIT_LOG remains admin-readable and append-only.
-- Reversibility: ../rollback/20260911120000_flag_unmatched_gmail_replies.down.sql

create function public.flag_unmatched_gmail_reply(
  p_provider_message_id text,
  p_provider_thread_id text,
  p_sender_email text,
  p_subject text,
  p_reply_body text,
  p_received_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review_id uuid := gen_random_uuid();
begin
  if nullif(btrim(p_provider_message_id), '') is null
     or nullif(btrim(p_sender_email), '') is null
     or nullif(btrim(p_reply_body), '') is null then
    raise exception 'provider message id, sender email and reply body are required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_provider_message_id, 132));

  if exists (
    select 1
      from public.audit_log
     where action in ('gmail_reply_captured', 'gmail_reply_needs_review')
       and detail ->> 'provider_message_id' = p_provider_message_id
  ) then
    return null;
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'gmail_reply_needs_review',
    'gmail_unmatched_replies',
    v_review_id,
    jsonb_build_object(
      'provider_message_id', p_provider_message_id,
      'provider_thread_id', p_provider_thread_id,
      'sender_email', lower(btrim(p_sender_email)),
      'subject', coalesce(p_subject, ''),
      'reply_body', btrim(p_reply_body),
      'received_at', p_received_at
    )
  );

  return v_review_id;
end;
$$;

comment on function public.flag_unmatched_gmail_reply(text, text, text, text, text, timestamptz) is
  'F132: deduplicates and retains an unmatched Gmail reply as an admin manual-review '
  'flag without attaching it to an unverified client. Service-role sync only.';

revoke execute on function public.flag_unmatched_gmail_reply(text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.flag_unmatched_gmail_reply(text, text, text, text, text, timestamptz)
  to service_role;
