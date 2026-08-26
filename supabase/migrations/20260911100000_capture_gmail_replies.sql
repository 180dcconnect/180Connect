-- Migration: capture_gmail_replies
-- Story: F131 Detect Replies.
--
-- The existing Data Model step 12 REPLY_EVENTS table is the approved destination.
-- This migration adds no table or column: it adds the atomic service-role ingestion
-- boundary needed by Gmail sync. The provider message id is retained in AUDIT_LOG,
-- whose jsonb detail is explicitly the approved action-context field.
--
-- A transaction advisory lock keyed by Gmail message id closes the race between two
-- overlapping cron invocations. A replay returns null and writes nothing. A first
-- capture inserts the append-only reply, marks the client responded, and records both
-- facts in audit_log in the same transaction. The status audit is required by
-- docs/audit-log-pattern.md; no status audit is added when it was already responded.
--
-- Security: service_role only. End users retain no write access to REPLY_EVENTS.
-- Reversibility: paired rollback in
-- ../rollback/20260911100000_capture_gmail_replies.down.sql

create function public.capture_gmail_reply(
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
  v_old_status public.outreach_status;
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

  select outreach_status into v_old_status
    from public.organisations
   where id = p_organisation_id
   for update;

  if v_old_status is distinct from 'responded'::public.outreach_status then
    update public.organisations
       set outreach_status = 'responded'
     where id = p_organisation_id;

    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      null,
      'status_changed',
      'organisations',
      p_organisation_id,
      jsonb_build_object(
        'from', v_old_status,
        'to', 'responded',
        'source', 'gmail_reply_sync',
        'reply_event_id', v_reply_id
      )
    );
  end if;

  return v_reply_id;
end;
$$;

comment on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) is
  'F131: atomically deduplicates and captures a matched Gmail reply, marks the '
  'organisation responded, and audits both writes. Service-role sync only.';

revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from public;
revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from anon;
revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from authenticated;
grant execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) to service_role;

-- REPLY_EVENTS is already in supabase_realtime (20260820110000), so this write
-- reaches the existing client-timeline subscription without publication changes.
