-- Migration: record_reviewed_recipient
-- Sequence: addition (needs public.outreach_messages, public.audit_log,
--   app.is_admin, app.is_active_user). Not a numbered step — RPC migrations are
--   not rows in Data Model tab 11, following set_outreach_status /
--   claim_outreach_send / create_claim_organisation_rpc.
-- Story: F116 — Review Recipient Email. Follow-up to the PR #489 review: the
--   recipient the CAM reviewed was validated and sent but never persisted —
--   OUTREACH_MESSAGES had no recipient column and SEND_EVENTS.metadata did not
--   record it either — so a deliberate override of the on-file address left no
--   trace of who actually received the email, weakening the audit trail for
--   exactly the misdirection risk this feature guards against.
--
-- WHAT THIS CHANGES:
--   1. Adds OUTREACH_MESSAGES.sent_to_email (text, nullable) — the address this
--      message was actually sent to. The server action stamps it when the CAM's
--      reviewed content is saved pre-send (so a failed provider call leaves an
--      editable draft showing precisely who the attempt targeted), and
--      mark_outreach_sent re-stamps it from its new parameter at the audited
--      draft→sent transition, so the delivered fact and the audit row can never
--      drift apart.
--
--   2. Replaces mark_outreach_sent(uuid, text, text) with a four-argument
--      version taking p_recipient_email: the value the transport was actually
--      given, not one re-derived from the contact record at recordal time.
--      The old three-argument signature is dropped — it only ever existed on
--      migrations applied by PR #458 before any caller outside sendReviewedEmail
--      existed, so no other caller can break. The audit_log detail gains
--      'sent_to' alongside the provider ids, completing "who sent what to whom"
--      in one row per delivery.
--
-- WHY A PARAMETER RATHER THAN READING THE COLUMN INSIDE THE RPC: the column is
-- written by an ordinary RLS-scoped UPDATE earlier in the same action, which a
-- future second caller could forget or fumble; the parameter makes the audited
-- transition self-contained — whatever the caller passed IS what gets recorded,
-- the same rule "reviewed content is what sends" already applies to subject and
-- body.
--
-- Schema change approval record (SOP §7):
--   Change        | Add OUTREACH_MESSAGES.sent_to_email (text, nullable).
--               | Replace mark_outreach_sent(uuid,text,text) with
--               | mark_outreach_sent(uuid,text,text,text).
--   Reason        | F116 review follow-up: a deliberately overridden recipient
--               | must leave a durable trace of who received the email; DoD
--               | requires the audit trail to survive the send path.
--   Compatibility | New nullable column — no backfill; existing sent rows read
--               | as "sent to the on-file address era" with no value, same as
--               | every message sent before F116 review existed. No existing
--               | query writes or selects it. The replaced RPC had exactly one
--               | production caller, updated in this PR.
--   Security      | Column inherits OUTREACH_MESSAGES' existing RLS (enabled at
--               | table creation); no policy change — read/write rules are
--               | row-level and unchanged. mark_outreach_sent remains SECURITY
--               | DEFINER with search_path pinned, still re-checks active-user +
--               | ownership inside the body; EXECUTE revoked from public/anon,
--               | granted to authenticated.
--   Documentation | Data Model tab 07: outreach_messages is not yet projected in
--               | docs/data-model/ on dev (same gap noted by
--               | 20260901110000_send_reviewed_outreach_safety), so there is no
--               | generated file to update in this PR. The spreadsheet row for
--               | sent_to_email should be added at the next projection refresh;
--               | noted here so the gap is deliberate, not missed.
--   Approved by   | Bashir (Project Leader), 25 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260901120000_record_reviewed_recipient.down.sql

-- ---------------------------------------------------------------------------
-- The delivered-recipient column
-- ---------------------------------------------------------------------------
alter table public.outreach_messages
  add column sent_to_email text;

comment on column public.outreach_messages.sent_to_email is
  'F116: the email address this message was actually sent to, as reviewed and '
  'approved by the CAM — not re-derived from the contact record. Stamped when the '
  'reviewed content is saved pre-send and confirmed by mark_outreach_sent at the '
  'audited draft→sent transition. Null for drafts that have never been sent and for '
  'messages sent before recipient review existed.';

-- ---------------------------------------------------------------------------
-- mark_outreach_sent(v2) — now records who received the email
-- ---------------------------------------------------------------------------
drop function public.mark_outreach_sent(uuid, text, text);

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

  -- Conditional on still being a draft: a second invocation (double click, retry
  -- after a timeout where the first attempt actually delivered) raises instead of
  -- recording a second sent state or silently matching zero rows.
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

comment on function public.mark_outreach_sent(uuid, text, text, text) is
  'F123/F116: records a delivered outreach email and the address it actually went '
  'to — the only ordinary write path for draft→sent, conditional on '
  'send_status=''draft'' and audited (recipient included) in the same transaction '
  'per docs/audit-log-pattern.md. Raises if the draft was already sent; the pipeline '
  'status change itself stays with set_outreach_status (its own audited RPC).';

revoke execute on function public.mark_outreach_sent(uuid, text, text, text) from public;
revoke execute on function public.mark_outreach_sent(uuid, text, text, text) from anon;
grant execute on function public.mark_outreach_sent(uuid, text, text, text) to authenticated;
