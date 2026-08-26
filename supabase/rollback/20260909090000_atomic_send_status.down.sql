-- Rollback of 20260909090000_atomic_send_status (F157 #152).
-- Restores:
--   1. mark_outreach_sent v2 — the F116 four-argument version WITHOUT the
--      pipeline advance (body verbatim from 20260901120000).
--   2. Drops mark_scheduled_outreach_delivered — callers revert to their raw
--      UPDATE + SEND_EVENTS insert (the pre-F157 cron behaviour).
--   3. Drops the internal advance_outreach_pipeline_on_send helper.
drop function if exists public.mark_outreach_sent(uuid, text, text, text);
drop function if exists public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz);
drop function if exists public.advance_outreach_pipeline_on_send(uuid, uuid);

create function public.mark_outreach_sent(
  p_message_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_recipient_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := (select auth.uid());
  v_message record;
  v_sent    uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select m.id,
         m.sent_by_user_id,
         m.organisation_id,
         o.owner_id as org_owner_id,
         m.send_status
    into v_message
    from public.outreach_messages m
    join public.organisations o on o.id = m.organisation_id
   where m.id = p_message_id
     for update of m;

  if v_message.id is null then
    raise exception 'that draft could not be found'
      using errcode = 'P0002';
  end if;

  if not (
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or v_message.sent_by_user_id = v_actor
  ) then
    raise exception 'only the client''s owner or an admin may record this send'
      using errcode = '42501';
  end if;

  update public.outreach_messages
     set send_status = 'sent',
         sent_at     = now(),
         scheduled_at = null,
         sent_to_email = p_recipient_email
   where id = v_message.id
     and send_status = 'draft'
  returning id into v_sent;

  if v_sent is null then
    raise exception 'this email has already been recorded as sent'
      using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'outreach_email_sent', 'outreach_messages', v_sent,
    jsonb_build_object(
      'organisation_id', v_message.organisation_id,
      'provider', 'gmail',
      'provider_message_id', p_provider_message_id,
      'provider_thread_id', p_provider_thread_id,
      'sent_to', p_recipient_email
    )
  );

  return v_sent;
end;
$$;

revoke execute on function public.mark_outreach_sent(uuid, text, text, text) from public;
revoke execute on function public.mark_outreach_sent(uuid, text, text, text) from anon;
grant execute on function public.mark_outreach_sent(uuid, text, text, text) to authenticated;
