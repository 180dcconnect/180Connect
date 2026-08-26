-- Migration: create_send_failure_handling
-- Created: 2026-09-03
-- Feature:  F129 (#124) — Send Failure Handling
--
--   Change        | Add 'failed' to send_event_type; two audited RPCs for the
--                 | failure lifecycle (record + recover)
--   Affected      | SEND_EVENTS, OUTREACH_MESSAGES, AUDIT_LOG
--   Dependencies  | create_outreach (20260804190000),
--                 | create_outreach_events (20260804200000),
--                 | send_reviewed_outreach_safety (20260901110000),
--                 | scheduled_outreach_safety (20260902120000),
--                 | create_notifications (20260822090000/...90100)
--
-- Why: OUTREACH_MESSAGES.send_status has carried a 'failed' value since
-- 20260804190000 but nothing ever set it — a scheduled email whose Gmail call
-- failed stayed 'scheduled' and was silently re-attempted on every cron run,
-- invisible to the CAM who scheduled it (F129 AC1's "silently disappearing").
-- SEND_EVENTS likewise had no event type able to record a failed attempt.
--
-- Two RPCs close the loop, both following the audited-send pattern of
-- 20260901110000 / 20260902120000 (docs/audit-log-pattern.md §1 — status
-- changes land their audit_log row in the same transaction):
--
--   mark_outreach_send_failed(message_id, reason): service_role only — the
--       cron worker records that a due delivery did not leave. Flips
--       scheduled→failed, writes the SEND_EVENTS 'failed' row, audits.
--
--   reopen_outreach_draft(message_id): authenticated — returns a failed
--       message to draft so it can be retried through the ordinary reviewed
--       send path without recreating content (F129 AC3). Admin-or-sender is
--       re-checked INSIDE the function; audited.

-- ---------------------------------------------------------------------------
-- send_event_type: record failed attempts
-- ---------------------------------------------------------------------------

alter type public.send_event_type add value if not exists 'failed';

comment on type public.send_event_type is
  'Delivery lifecycle events written by the Gmail send path. ''failed'' '
  '(F129) records a send attempt that did not reach Gmail successfully; '
  'metadata holds {reason, retryable, provider, scheduled}.';

-- ---------------------------------------------------------------------------
-- mark_outreach_send_failed — the worker's scheduled→failed transition
-- ---------------------------------------------------------------------------

create or replace function public.mark_outreach_send_failed(
  p_message_id uuid,
  p_reason     text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outreach_messages;
begin
  -- Definer bypasses RLS, so authorise explicitly: this transition belongs to
  -- the scheduled-delivery worker, which runs as service_role (null auth.uid()).
  -- A signed-in user has no business failing someone else's queued email.
  if (select auth.uid()) is not null then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a failure reason is required' using errcode = '22004';
  end if;

  select * into v_row
  from public.outreach_messages m
  where m.id = p_message_id;
  if not found then
    return false;
  end if;

  -- Conditional on still-scheduled: a message cancelled or claimed elsewhere
  -- between the worker's SELECT and here must surface as "no rows" rather
  -- than being stamped failed anyway.
  update public.outreach_messages m
     set send_status      = 'failed',
         send_claimed_at  = null
   where m.id = p_message_id
     and m.send_status = 'scheduled';
  if not found then
    return false;
  end if;

  -- The durable per-message diagnosis (F129 AC2): what failed, when, why.
  insert into public.send_events (
    outreach_message_id, event_type, occurred_at, metadata
  ) values (
    p_message_id, 'failed', now(),
    jsonb_build_object(
      'provider', 'gmail',
      'reason',    left(trim(p_reason), 512),
      'scheduled', true
    )
  );

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'outreach_send_failed',
    'outreach_messages',
    p_message_id,
    jsonb_build_object(
      'organisation_id', v_row.organisation_id,
      'sent_by_user_id', v_row.sent_by_user_id,
      'reason',          left(trim(p_reason), 512)
    )
  );

  return true;
end;
$$;

comment on function public.mark_outreach_send_failed(uuid, text) is
  'F129: service_role-only scheduled→failed transition. Records the SEND_EVENTS '
  '''failed'' row and the audit_log entry in the same transaction; conditional '
  'on send_status=''scheduled'' so a raced cancel or claim wins instead.';

revoke execute on function public.mark_outreach_send_failed(uuid, text) from public;
revoke execute on function public.mark_outreach_send_failed(uuid, text) from anon;
revoke execute on function public.mark_outreach_send_failed(uuid, text) from authenticated;
grant execute on function public.mark_outreach_send_failed(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- reopen_outreach_draft — the audited failed→draft recovery transition
-- ---------------------------------------------------------------------------

create or replace function public.reopen_outreach_draft(
  p_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid;
  v_org    uuid;
begin
  if (select auth.uid()) is null or not app.is_active_user() then
    raise exception 'active account required' using errcode = '42501';
  end if;

  select m.sent_by_user_id, m.organisation_id into v_sender, v_org
  from public.outreach_messages m
  where m.id = p_message_id;
  if not found then
    return false;
  end if;

  -- Same rule as sending and discarding: the sender, or an admin. RLS lets
  -- every active user READ every row, so the ownership line has to be drawn
  -- here inside the definer body, not left to a silent no-op.
  if v_sender is distinct from (select auth.uid())
     and not app.is_admin() then
    raise exception 'only the sender or an admin can retry this email'
      using errcode = '42501';
  end if;

  update public.outreach_messages m
     set send_status      = 'draft',
         send_claimed_at  = null,
         scheduled_at     = null
   where m.id = p_message_id
     and m.send_status = 'failed';
  if not found then
    return false;
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    (select auth.uid()),
    'outreach_send_reopened',
    'outreach_messages',
    p_message_id,
    jsonb_build_object('organisation_id', v_org)
  );

  return true;
end;
$$;

comment on function public.reopen_outreach_draft(uuid) is
  'F129 AC3: failed→draft so a failed email can be retried through the normal '
  'reviewed send path with its reviewed content intact. Admin-or-sender '
  're-checked inside; conditional on send_status=''failed''; audited in the '
  'same transaction per docs/audit-log-pattern.md.';

revoke execute on function public.reopen_outreach_draft(uuid) from public;
revoke execute on function public.reopen_outreach_draft(uuid) from anon;
grant execute on function public.reopen_outreach_draft(uuid) to authenticated;

-- ../rollback/20260903140000_create_send_failure_handling.down.sql
