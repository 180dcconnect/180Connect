-- Migration: atomic_send_status
-- Sequence: addition (needs public.outreach_messages, public.organisations,
--   public.audit_log, public.send_events, app.is_admin, app.is_active_user).
--   Not a numbered step — RPC migrations are not rows in Data Model tab 11,
--   following set_outreach_status / mark_outreach_sent / mark_outreach_send_failed.
-- Story: F157 (#152) — Automatic Status Update on Email Sent.
--
-- WHAT THIS CHANGES:
--   Sending an email and the pipeline advance it causes become ONE transaction,
--   on BOTH send paths:
--
--   1. mark_outreach_sent(uuid,text,text,text) is replaced (same signature) with
--      a version that, after the audited draft→sent flip, advances the sender
--      organisation's outreach_status (not_contacted → initial_outreach_sent,
--      anything else → follow_up_sent) and writes the status_changed audit row —
--      inside the same transaction. The server action's old post-RPC
--      set_outreach_status call is deleted with this migration (F147's PR #500
--      left it best-effort by design; F157's AC3 requires the guarantee).
--
--   2. New mark_scheduled_outreach_delivered(uuid,text,text,timestamptz),
--      service_role only, replaces the cron worker's raw UPDATE + SEND_EVENTS
--      insert (which recorded a delivered scheduled email with NO audit row and
--      NO pipeline advance at all): claim-pinned scheduled→sent flip, the
--      SEND_EVENTS 'sent' row, the outreach_email_sent audit entry, and the
--      same pipeline advance, all in one transaction.
--
-- WHY THE ADVANCE LIVES IN THE RPCs RATHER THAN THE CALLER: AC3 forbids a
-- separate step that can fail independently and leave the status stale — the
-- email being out while the dashboard says Not Contacted is precisely the
-- inconsistency this ticket exists to prevent. Both RPCs take `for update` locks
-- on the message AND the organisation row up front, which also closes the
-- read-then-write race PR #500's review flagged: two near-simultaneous sends to
-- one client serialize on the org lock, so the second correctly lands on
-- follow_up_sent rather than a second initial_outreach_sent.
--
-- THE RULE ITSELF (one branch, stated once): public.advance_outreach_pipeline_on_send
-- is shared by both RPCs so the not_contacted → initial / else → follow_up rule
-- cannot drift between the manual and scheduled paths. It is an INTERNAL helper:
-- EXECUTE is revoked everywhere; only the two definer RPCs reach it. Same-status
-- no-op skips the audit row (audit-log-pattern.md §5, as set_outreach_status).
--
-- Schema change approval record (SOP §7):
--   Change        | Replace mark_outreach_sent(uuid,text,text,text) with the
--               | version that also advances ORGANISATIONS.outreach_status;
--               | add mark_scheduled_outreach_delivered(uuid,text,text,timestamptz)
--               | granted to service_role only; add internal helper
--               | advance_outreach_pipeline_on_send(uuid,uuid).
--   Reason        | F157 AC1/AC2 (auto-update on any send) and AC3 (same
--               | transaction as the send); also fixes the scheduled path
--               | recording deliveries un-audited and never advancing the
--               | pipeline.
--   Compatibility | No column or type changes. The replaced RPC had exactly one
--               | production caller (sendReviewedEmail), updated in this PR; its
--               | signature is unchanged, so no other caller could break even if
--               | one existed. The new RPC has exactly one caller (the F126 cron
--               | worker's markSent port adapter), also updated in this PR.
--   Security      | Both RPCs are SECURITY DEFINER with search_path pinned.
--               | mark_outreach_sent keeps its active-user + ownership checks;
--               | mark_scheduled_outreach_delivered follows the
--               | mark_outreach_send_failed precedent — auth.uid() must be null
--               | and EXECUTE is revoked from every non-service role. The helper
--               | is EXECUTE-revoked from everyone (definer-internal only).
--   Documentation | docs/rls-permission-matrix.md §3.3 updated in the same PR.
--               | No Data Model tab changes: no tables or columns added.
--   Approved by   | Bashir (Project Manager), 26 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260909090000_atomic_send_status.down.sql

-- ---------------------------------------------------------------------------
-- Shared pipeline advance — internal, definer-called only
-- ---------------------------------------------------------------------------
create function public.advance_outreach_pipeline_on_send(
  p_organisation_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.outreach_status;
  v_next    public.outreach_status;
begin
  -- Lock the row: serializes two near-simultaneous sends so the second sees
  -- the first's committed status and lands on follow_up_sent, never a second
  -- 'initial'.
  select o.outreach_status into v_current
    from public.organisations o
   where o.id = p_organisation_id
     for update;

  if v_current is null then
    -- The message's organisation vanished mid-transaction; there is nothing to
    -- advance and nothing to audit. The caller's own flip already succeeded.
    return;
  end if;

  -- F147 AC1/AC2: the very first send leaves not_contacted; any later send
  -- reads follow_up_sent, whatever the client currently says.
  v_next := case when v_current = 'not_contacted'
                 then 'initial_outreach_sent'::public.outreach_status
                 else 'follow_up_sent'::public.outreach_status end;

  if v_current = v_next then
    return;  -- same-status no-op is not audited (audit-log-pattern.md §5)
  end if;

  update public.organisations
     set outreach_status = v_next
   where id = p_organisation_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    p_actor, 'status_changed', 'organisations', p_organisation_id,
    jsonb_build_object('from', v_current, 'to', v_next)
  );
end;
$$;

comment on function public.advance_outreach_pipeline_on_send(uuid, uuid) is
  'F157 internal: advances a client''s pipeline status after a confirmed send '
  '(not_contacted → initial_outreach_sent, else → follow_up_sent) and writes the '
  'status_changed audit row under the caller''s transaction. Called only by '
  'mark_outreach_sent and mark_scheduled_outreach_delivered; EXECUTE revoked from '
  'every role.';

revoke all on function public.advance_outreach_pipeline_on_send(uuid, uuid) from public;
revoke all on function public.advance_outreach_pipeline_on_send(uuid, uuid) from anon;
revoke all on function public.advance_outreach_pipeline_on_send(uuid, uuid) from authenticated;
revoke all on function public.advance_outreach_pipeline_on_send(uuid, uuid) from service_role;

-- ---------------------------------------------------------------------------
-- mark_outreach_sent(v3) — the audited draft→sent transition now carries the
-- pipeline advance with it
-- ---------------------------------------------------------------------------
drop function public.mark_outreach_sent(uuid, text, text, text);

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

  -- Locked on BOTH rows: the message so the draft→sent flip stays race-free as
  -- before, the organisation so the pipeline advance below cannot interleave
  -- with another send's advance (see header).
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

  -- Conditional on still being a draft: a second invocation (double click, retry
  -- after a timeout where the first attempt actually delivered) raises instead of
  -- recording a second sent state or silently matching zero rows. The pipeline
  -- advance below only runs on the winning invocation — a refused double-record
  -- must not move the status twice.
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

  -- F157 AC3: the status move is part of THIS transaction — if anything below
  -- fails, the whole recordal rolls back and the caller reports the send as
  -- unrecorded rather than leaving the dashboard stale.
  perform public.advance_outreach_pipeline_on_send(v_message.organisation_id, v_actor);

  return v_sent;
end;
$$;

comment on function public.mark_outreach_sent(uuid, text, text, text) is
  'F123/F116/F157: records a delivered outreach email — the only ordinary write '
  'path for draft→sent, conditional on send_status=''draft'', and in ONE '
  'transaction records the recipient on the audit trail and advances the '
  'client''s pipeline status (first send initial_outreach_sent, later '
  'sends follow_up_sent). Raises if the draft was already sent; a refused '
  'double-record does not touch the pipeline.';

revoke execute on function public.mark_outreach_sent(uuid, text, text, text) from public;
revoke execute on function public.mark_outreach_sent(uuid, text, text, text) from anon;
grant execute on function public.mark_outreach_sent(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_scheduled_outreach_delivered — the worker's audited scheduled→sent
-- transition (replaces the cron path's raw, un-audited UPDATE)
-- ---------------------------------------------------------------------------
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
  -- Definer bypasses RLS, so authorise explicitly: this transition belongs to
  -- the scheduled-delivery worker, which runs as service_role (null auth.uid())
  -- — same line mark_outreach_send_failed draws. A signed-in user records
  -- sends through mark_outreach_sent instead.
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

  -- Pinned to OUR claim token (the timestamp this run wrote into
  -- send_claimed_at), exactly like the raw UPDATE it replaces: a successful
  -- Gmail call followed by zero rows here means the message was cancelled or
  -- re-claimed mid-delivery — ambiguous, reported, never retried (F123's
  -- duplicate-email rule). Only the winner advances the pipeline.
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

comment on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) is
  'F126/F129/F157: service_role-only scheduled→sent transition for the cron '
  'worker — conditional on send_status=''scheduled'' AND this run''s exact '
  'claim token, records the SEND_EVENTS ''sent'' row and the outreach_email_sent '
  'audit entry, and advances the client''s pipeline status, ALL in one '
  'transaction. False means the message was raced away (cancelled/re-claimed '
  'elsewhere): the email MAY be out, so the caller reports ambiguity and never '
  'retries.';

revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) from public;
revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) from anon;
revoke execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) from authenticated;
grant execute on function public.mark_scheduled_outreach_delivered(uuid, text, text, timestamptz) to service_role;
