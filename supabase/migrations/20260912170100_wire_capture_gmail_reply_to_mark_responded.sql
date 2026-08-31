-- Migration: wire_capture_gmail_reply_to_mark_responded
-- Story: F149 (#144), fix-forward on F131's capture_gmail_reply
-- (20260912160000_capture_gmail_replies.sql, already applied to staging).
--
-- capture_gmail_reply flipped a client straight to 'responded' on any status
-- other than 'responded' itself — no check against a manual, final decision
-- (converted, future_potential, soft_no, hard_no, no_response,
-- loss_due_timing). F149's whole point is that a reply arriving after a CAM
-- already closed the engagement must not silently reopen it. This redefines
-- the function to delegate the transition to mark_organisation_responded
-- (20260912170000), which carries that exact guarantee, instead of
-- duplicating an unprotected copy of the same logic inline.
--
-- Schema change approval record (SOP §7):
--   Change        | Redefine capture_gmail_reply to call
--                 | mark_organisation_responded instead of updating
--                 | organisations.outreach_status directly.
--   Reason        | F149 AC2 — closes a live gap where a reply could
--                 | override a manual/final status.
--   Compatibility | Signature, grants and dedup/lock behaviour unchanged.
--                 | Only the status-transition body changes.
--   Data migration| None.
--   Security      | Unchanged — service_role only, same as
--                 | 20260912160000_capture_gmail_replies.sql.
-- Reversibility: paired rollback in
--   ../rollback/20260912170100_wire_capture_gmail_reply_to_mark_responded.down.sql

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
  -- manual/final status" guarantee and writes its own status_changed audit
  -- row (trigger: 'reply_detected') when it actually transitions. A no-op
  -- (already responded, or a final status) is expected and silent here —
  -- the reply itself is still captured either way.
  perform public.mark_organisation_responded(p_organisation_id);

  return v_reply_id;
end;
$$;

comment on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) is
  'F131: atomically deduplicates and captures a matched Gmail reply, resolves a '
  'prior unmatched-reply review flag for the same provider message id if one '
  'exists, and delegates the responded transition to mark_organisation_responded '
  '(F149), which never overrides a manual/final status. Service-role sync only.';
