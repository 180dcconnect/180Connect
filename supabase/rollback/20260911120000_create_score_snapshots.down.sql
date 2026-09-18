-- Rollback of 20260911120000_create_score_snapshots (F097 #96).
-- Restores:
--   1. mark_outreach_sent v3 — the F157 four-argument version WITHOUT the
--      snapshot insert (body verbatim from 20260909090000).
--   2. mark_scheduled_outreach_delivered — the F157 four-argument version,
--      likewise without the snapshot insert.
--   3. Drops the internal insert_score_snapshot helper and SCORE_SNAPSHOTS.
-- Snapshots already filed are derived from real sends; they leave with the
-- mechanism, which is acceptable for a rollback of an additive feature.

drop function if exists public.mark_outreach_sent(uuid, text, text, text, jsonb);
drop function if exists public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz, jsonb);
drop function if exists public.insert_score_snapshot(uuid, uuid, jsonb);

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
     for update of m, o;

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

  perform public.advance_outreach_pipeline_on_send(v_message.organisation_id, v_actor);

  return v_sent;
end;
$$;

revoke execute on function public.mark_outreach_sent(uuid, text, text, text) from public;
revoke execute on function public.mark_outreach_sent(uuid, text, text, text) from anon;
grant execute on function public.mark_outreach_sent(uuid, text, text, text) to authenticated;

create function public.mark_scheduled_outreach_delivered(
  p_message_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_claim_token timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if (select auth.uid()) is not null then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select m.id, m.organisation_id
    into v_row
    from public.outreach_messages m
    join public.organisations o on o.id = m.organisation_id
   where m.id = p_message_id
     for update of m, o;

  if v_row.id is null then
    return false;
  end if;

  update public.outreach_messages
     set send_status = 'sent',
         sent_at = now(),
         scheduled_at = null,
         send_claimed_at = null
   where id = p_message_id
     and send_status = 'scheduled'
     and send_claimed_at = p_claim_token
  returning id into v_row.id;

  if v_row.id is null then
    return false;
  end if;

  insert into public.send_events (
    outreach_message_id, event_type, occurred_at, metadata
  ) values (
    p_message_id, 'sent', now(),
    jsonb_build_object(
      'provider', 'gmail',
      'message_id', p_provider_message_id,
      'thread_id', p_provider_thread_id,
      'scheduled', true
    )
  );

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'outreach_email_sent',
    'outreach_messages',
    p_message_id,
    jsonb_build_object(
      'organisation_id', v_row.organisation_id,
      'provider', 'gmail',
      'provider_message_id', p_provider_message_id,
      'provider_thread_id', p_provider_thread_id,
      'scheduled', true
    )
  );

  perform public.advance_outreach_pipeline_on_send(v_row.organisation_id, null);

  return true;
end;
$$;

revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) from public;
revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) from anon;
revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) from authenticated;
grant execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) to service_role;

drop table if exists public.score_snapshots;
