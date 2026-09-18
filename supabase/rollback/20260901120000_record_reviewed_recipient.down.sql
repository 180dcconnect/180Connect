-- Rollback for record_reviewed_recipient (F116, PR #489).
-- Reverses 20260901120000_record_reviewed_recipient.sql: drops sent_to_email and
-- restores the three-argument mark_outreach_sent from
-- 20260901110000_send_reviewed_outreach_safety.sql. The record of who received a
-- delivered email is lost with the column; send_status, sent_at and existing
-- audit_log rows are untouched.

drop function if exists public.mark_outreach_sent(uuid, text, text, text);

create function public.mark_outreach_sent(
  p_message_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text
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
         scheduled_at = null
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
      'provider_thread_id', p_provider_thread_id
    )
  );

  return v_sent;
end;
$$;

revoke execute on function public.mark_outreach_sent(uuid, text, text) from public;
revoke execute on function public.mark_outreach_sent(uuid, text, text) from anon;
grant execute on function public.mark_outreach_sent(uuid, text, text) to authenticated;

alter table public.outreach_messages
  drop column if exists sent_to_email;
