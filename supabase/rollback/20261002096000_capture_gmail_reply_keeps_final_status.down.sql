-- Rollback: capture_gmail_reply_keeps_final_status
--
-- Restores the capture_reply_author definition, including its direct status
-- update. Rolling this back reintroduces the F149 regression; that is what
-- reversing it means.

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
  v_old_status public.outreach_status;
  v_sender_email text;
  v_contact_id uuid;
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

  v_sender_email := nullif(lower(btrim(p_sender_email)), '');

  -- Match the sender to a contact ON THIS ORGANISATION. Scoped to the
  -- organisation rather than matched globally, because a shared address
  -- ("info@") would otherwise be free to resolve to whoever holds it on some
  -- other record. Primary contacts win a tie, then the oldest row, so the
  -- result is deterministic rather than whatever the planner returns first.
  if v_sender_email is not null then
    select contact.id into v_contact_id
      from public.contacts as contact
     where contact.organisation_id = p_organisation_id
       and contact.email is not null
       and lower(btrim(contact.email)) = v_sender_email
     order by contact.is_primary desc, contact.created_at, contact.id
     limit 1;
  end if;

  insert into public.reply_events (
    outreach_message_id, organisation_id, reply_body, received_at,
    contact_id, sender_email
  ) values (
    p_outreach_message_id, p_organisation_id, btrim(p_reply_body), p_received_at,
    v_contact_id, v_sender_email
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
      'sender_email', v_sender_email,
      'contact_id', v_contact_id
    )
  );

  -- A prior cron run may have been unable to match this same message and
  -- flagged it for manual review (flag_unmatched_gmail_reply). The two RPCs
  -- use different advisory-lock salts, so overlapping runs seeing different
  -- snapshots of the sent-outreach list can genuinely disagree — this closes
  -- the resulting gap rather than leaving a resolved review item looking
  -- unresolved. Append-only, same as every other audit_log write here.
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

revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from public;
revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from anon;
revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from authenticated;
grant execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) to service_role;
