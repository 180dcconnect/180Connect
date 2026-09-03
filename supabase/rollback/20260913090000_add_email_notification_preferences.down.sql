-- Rollback for 20260913090000_add_email_notification_preferences.sql
-- (F179, #175).
--
-- Restores capture_gmail_reply to its exact 20260912170100 body (no
-- in-app notification call, no owner/name lookup), then drops the new
-- column. Data loss on rollback: every user's email_notification_types
-- preference, and any NOTIFICATIONS rows already produced with
-- notification_type = 'reply_received' are left in place — they are inert
-- once this function stops creating new ones, and deleting them would be a
-- data-loss step outside what "reversing this migration" means.

create or replace function public.capture_gmail_reply(
  p_provider_message_id text,
  p_outreach_message_id uuid,
  p_organisation_id uuid,
  p_reply_body text,
  p_received_at timestamptz,
  p_sender_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reply_id uuid;
begin
  if nullif(btrim(p_provider_message_id), '') is null
     or nullif(btrim(p_reply_body), '') is null then
    raise exception 'provider message id and reply body are required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_provider_message_id, 131));

  if exists (
    select 1
      from public.audit_log
     where action = 'gmail_reply_captured'
       and detail ->> 'provider_message_id' = p_provider_message_id
  ) then
    return null;
  end if;

  if not exists (
    select 1
      from public.outreach_messages
     where id = p_outreach_message_id
       and organisation_id = p_organisation_id
       and send_status = 'sent'
  ) then
    raise exception 'reply does not match a sent outreach message'
      using errcode = '23503';
  end if;

  insert into public.reply_events (
    outreach_message_id, organisation_id, reply_body, received_at
  ) values (
    p_outreach_message_id, p_organisation_id, btrim(p_reply_body), p_received_at
  ) returning id into v_reply_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'gmail_reply_captured',
    'reply_events',
    v_reply_id,
    jsonb_build_object(
      'organisation_id', p_organisation_id,
      'outreach_message_id', p_outreach_message_id,
      'provider_message_id', p_provider_message_id,
      'sender_email', lower(p_sender_email)
    )
  );

  if exists (
    select 1
      from public.audit_log
     where action = 'gmail_reply_needs_review'
       and detail ->> 'provider_message_id' = p_provider_message_id
  ) then
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      null,
      'gmail_reply_review_resolved',
      'reply_events',
      v_reply_id,
      jsonb_build_object(
        'provider_message_id', p_provider_message_id,
        'organisation_id', p_organisation_id
      )
    );
  end if;

  perform public.mark_organisation_responded(p_organisation_id);

  return v_reply_id;
end;
$$;

comment on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) is
  'F131: atomically deduplicates and captures a matched Gmail reply, resolves a '
  'prior unmatched-reply review flag for the same provider message id if one '
  'exists, and delegates the responded transition to mark_organisation_responded '
  '(F149), which never overrides a manual/final status. Service-role sync only.';

alter table public.users drop column if exists email_notification_types;
