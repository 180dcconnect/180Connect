-- Migration: scheduled_outreach_safety
-- Sequence: addition (needs public.outreach_messages, public.organisations,
--   public.suppressions, public.audit_log, app.is_admin, app.is_active_user).
--   Not a numbered step — RPC migrations are not rows in Data Model tab 11,
--   following send_reviewed_outreach_safety / set_outreach_status.
-- Story: F126 (#122) — Schedule Reviewed Outreach Emails. Stacked on F123's
--   audited-send pattern (20260901110000): scheduling is also a status change,
--   so it follows docs/audit-log-pattern.md the same way sending does.
--
-- WHAT THIS CHANGES — two SECURITY DEFINER RPCs, no schema change:
--
--   1. schedule_outreach_send(message_id, subject, body, scheduled_at): the ONLY
--      ordinary write path for draft→scheduled. Saves the exact reviewed content
--      and the requested delivery time on the still-draft row. Conditional on
--      send_status='draft' (a raced or already-sent draft raises instead of
--      silently matching zero rows), re-checks authorisation and suppression
--      INSIDE the function (SECURITY DEFINER bypasses RLS, per audit-log-pattern
--      §2), and writes the audit_log row in the same transaction.
--
--   2. cancel_outreach_schedule(message_id): the ONLY write path for
--      scheduled→draft. This is why the RPC exists at all: RLS pins every
--      outreach_messages UPDATE to draft rows (outreach_messages_update_admin /
--      _own_draft), so a direct client update can never un-schedule anything —
--      it would silently match zero rows while the UI reported success. Same
--      authorisation re-check, same same-transaction audit row.
--
-- sent_by_user_id is set by schedule_outreach_send to whoever scheduled the
-- email: the worker sends on their behalf later, and "who sent an email is a
-- fact about the email" (F125) — attribution must survive until delivery even
-- though no human is present at the moment Gmail is called.
--
-- Both RPCs refuse while a fresh send claim (send_claimed_at, F123) is held:
-- that means the cron worker is mid-Gmail-call for this message. Cancelling
-- then would tell the CAM "cancelled" while the email was already leaving;
-- re-scheduling then could flip the row out from under markSent's
-- still-scheduled condition. Claims older than the staleness window are stale
-- (crashed worker) and do not block.
--
-- Schema change approval record (SOP §7):
--   Change        | Add schedule_outreach_send(uuid,text,text,timestamptz) and
--               | cancel_outreach_schedule(uuid) SECURITY DEFINER RPCs.
--   Reason        | F126 AC: a reviewed email can be queued for future delivery
--               | and cancelled; DoD "all database writes follow the approved
--               | schema" requires both status transitions to be audited (F221).
--   Compatibility | No column or table changes; existing queries unaffected.
--               | The cron worker keeps its service-role write for the actual
--               | scheduled→sent flip (no auth.uid() exists to attribute or
--               | authorise there); its delivery is recorded in send_events.
--   Security      | Both RPCs are SECURITY DEFINER with search_path pinned,
--               | both re-check active-user + ownership + suppression inside
--               | the body; EXECUTE revoked from public/anon, granted to
--               | authenticated.
--   Documentation | Data Model tab 07: outreach_messages is not yet projected
--               | in docs/data-model/ on dev; noted here so the gap stays
--               | deliberate (same as 20260901110000).
--   Approved by   | Bashir (Project Leader), 26 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260902120000_scheduled_outreach_safety.down.sql

-- ---------------------------------------------------------------------------
-- schedule_outreach_send — the audited draft→scheduled transition
-- ---------------------------------------------------------------------------
create or replace function public.schedule_outreach_send(
  p_message_id uuid,
  p_subject text,
  p_body text,
  p_scheduled_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_message  record;
  v_row      public.outreach_messages;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if p_scheduled_at <= now() then
    raise exception 'a scheduled email must be in the future'
      using errcode = '22007';
  end if;

  select m.id,
         m.sent_by_user_id,
         m.organisation_id,
         o.owner_id as org_owner_id,
         m.send_claimed_at
    into v_message
    from public.outreach_messages m
    join public.organisations o on o.id = m.organisation_id
   where m.id = p_message_id
     for update of m;

  if v_message.id is null then
    raise exception 'that draft could not be found'
      using errcode = 'P0002';
  end if;

  if v_message.send_claimed_at > now() - public.send_claim_staleness_window() then
    raise exception 'this email is being delivered right now'
      using errcode = 'P0001';
  end if;

  -- Authorisation re-checked inside the SECURITY DEFINER body: the CAM who owns
  -- the client (or owns the draft), or an admin — identical rule to F123's
  -- claim/mark pair, so scheduling cannot succeed where sending would refuse.
  if not (
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or v_message.sent_by_user_id = v_actor
  ) then
    raise exception 'only the client''s owner or an admin may schedule this draft'
      using errcode = '42501';
  end if;

  -- Suppression checked at schedule time as well as at point-of-send (the cron
  -- worker re-checks before calling Gmail): a client suppressed after the page
  -- loaded must not gain a pending delivery.
  if exists (
    select 1
      from public.suppressions s
     where s.organisation_id = v_message.organisation_id
       and s.status = 'active'
  ) then
    raise exception 'this client is suppressed; outreach is blocked'
      using errcode = 'P0001';
  end if;

  -- Conditional on still being a draft, like mark_outreach_sent: a second
  -- invocation or a raced send raises instead of silently matching zero rows.
  update public.outreach_messages m
     set subject          = p_subject,
         body             = p_body,
         sent_by_user_id  = v_actor,
         send_status      = 'scheduled',
         scheduled_at     = p_scheduled_at
    where m.id = v_message.id
      and m.send_status = 'draft'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'this email is no longer an unsent draft'
      using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'outreach_email_scheduled', 'outreach_messages', v_row.id,
    jsonb_build_object(
      'organisation_id', v_message.organisation_id,
      'scheduled_at', p_scheduled_at,
      'subject', p_subject
    )
  );

  return v_row.id;
end;
$$;

comment on function public.schedule_outreach_send(uuid, text, text, timestamptz) is
  'F126: queues a reviewed outreach email for future delivery — the only ordinary '
  'write path for draft→scheduled, conditional on send_status=''draft'', '
  'authorisation- and suppression-rechecked inside, and audited in the same '
  'transaction per docs/audit-log-pattern.md. Records the scheduler as '
  'sent_by_user_id so attribution survives until the worker delivers.';

-- ---------------------------------------------------------------------------
-- cancel_outreach_schedule — the audited scheduled→draft transition
-- ---------------------------------------------------------------------------
create or replace function public.cancel_outreach_schedule(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_message  record;
  v_row      public.outreach_messages;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select m.id,
         m.sent_by_user_id,
         m.organisation_id,
         o.owner_id as org_owner_id,
         m.send_claimed_at,
         m.scheduled_at as was_scheduled_for
    into v_message
    from public.outreach_messages m
    join public.organisations o on o.id = m.organisation_id
   where m.id = p_message_id
     for update of m;

  if v_message.id is null then
    raise exception 'that scheduled email could not be found'
      using errcode = 'P0002';
  end if;

  -- A fresh claim means the cron worker is mid-Gmail-call for this message.
  -- Cancelling now would report success while the email was already leaving —
  -- refuse, and let the CAM retry once the claim goes stale or clears.
  if v_message.send_claimed_at > now() - public.send_claim_staleness_window() then
    raise exception 'this email is being delivered right now and can no longer be cancelled'
      using errcode = 'P0001';
  end if;

  if not (
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or v_message.sent_by_user_id = v_actor
  ) then
    raise exception 'only the client''s owner or an admin may cancel this schedule'
      using errcode = '42501';
  end if;

  update public.outreach_messages m
     set send_status      = 'draft',
         scheduled_at     = null,
         send_claimed_at  = null
    where m.id = v_message.id
      and m.send_status = 'scheduled'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'this email is no longer scheduled'
      using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'outreach_schedule_cancelled', 'outreach_messages', v_row.id,
    jsonb_build_object(
      'organisation_id', v_message.organisation_id,
      -- Pre-update value: v_row's scheduled_at is already nulled by the flip.
      'was_scheduled_for', v_message.was_scheduled_for
    )
  );

  return v_row.id;
end;
$$;

comment on function public.cancel_outreach_schedule(uuid) is
  'F126: returns a scheduled email to a plain draft — the only write path for '
  'scheduled→draft, which RLS cannot express because every outreach_messages '
  'UPDATE policy is pinned to send_status=''draft''. Audited per '
  'docs/audit-log-pattern.md.';

revoke execute on function public.schedule_outreach_send(uuid, text, text, timestamptz) from public;
revoke execute on function public.schedule_outreach_send(uuid, text, text, timestamptz) from anon;
grant execute on function public.schedule_outreach_send(uuid, text, text, timestamptz) to authenticated;

revoke execute on function public.cancel_outreach_schedule(uuid) from public;
revoke execute on function public.cancel_outreach_schedule(uuid) from anon;
grant execute on function public.cancel_outreach_schedule(uuid) to authenticated;
