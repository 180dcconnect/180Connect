-- Migration: capture_gmail_reply_keeps_final_status
-- Story: F149 Reply after a final decision (regression fix), F131 Detect Replies.
--
-- WHY THIS MIGRATION EXISTS: capture_reply_author (20261002092000) redefined
-- capture_gmail_reply to record who wrote a reply, and in doing so restored the
-- direct `update organisations set outreach_status = 'responded'` that F149
-- (20260912170100) had removed. A reply arriving after a CAM had closed the
-- engagement — converted, hard_no, no_response and the other final states —
-- silently reopened it. This keeps the reply-author capture exactly as it is and
-- puts the transition back behind mark_organisation_responded, which refuses to
-- override a final status.
--
-- A new migration rather than an edit to capture_reply_author: that migration is
-- already applied on staging under its recorded version, so an edit to its file
-- would never run there.
--
-- Schema change approval record (SOP §7):
--   Change        | Redefine capture_gmail_reply to call mark_organisation_responded
--                 | instead of updating organisations.outreach_status directly.
--   Reason        | F149 AC2 regression introduced by capture_reply_author.
--   Compatibility | Signature, grants, dedup/lock and reply-author behaviour unchanged.
--   Data migration| None. An organisation already reopened by the regression stays as
--                 | it is; nothing here can tell a CAM's later edit from the bug's.
--   Security      | Unchanged — service_role only.
--
-- Reversibility: ../rollback/20261002096000_capture_gmail_reply_keeps_final_status.down.sql

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

  -- F149 AC2: mark_organisation_responded carries the "never override a
  -- manual/final status" guarantee and writes its own status_changed audit row
  -- when it actually transitions. A no-op (already responded, or a final status
  -- such as converted, hard_no or no_response) is expected and silent — the
  -- reply and its author are still captured either way.
  perform public.mark_organisation_responded(p_organisation_id);

  return v_reply_id;
end;
$$;

comment on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) is
  'F131: atomically deduplicates and captures a matched Gmail reply, resolves '
  'the sender to a contact on the record (reply_events.contact_id + '
  'sender_email), resolves a prior unmatched-reply review flag for the same '
  'provider message id if one exists, and delegates the responded transition to '
  'mark_organisation_responded (F149), which never overrides a final status. '
  'Service-role sync only.';

revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from public;
revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from anon;
revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from authenticated;
grant execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) to service_role;
