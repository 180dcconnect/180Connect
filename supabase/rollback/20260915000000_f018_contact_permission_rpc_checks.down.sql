-- Rollback: 20260915000000_f018_contact_permission_rpc_checks
-- Restores the three outreach RPCs to their pre-F018 authorisation predicates:
--   claim_outreach_send        <- 20260913100100_enforce_daily_send_limit_atomically
--                                  (F128's body, atomic daily cap intact)
--   schedule_outreach_send     <- 20260902120000_scheduled_outreach_safety
--   mark_outreach_sent         <- 20260911120000_create_score_snapshots (F097, 5-arg)
-- i.e. the draft-author clause no longer requires an unowned client. F128's
-- daily-cap enforcement and F097's score-snapshot behaviour are preserved.

create or replace function public.claim_outreach_send(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_message      record;
  v_claimed      uuid;
  v_daily_limit  integer;
  v_today_start  timestamptz;
  v_today_count  bigint;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select m.id,
         m.sent_by_user_id,
         m.organisation_id,
         o.owner_id as org_owner_id
    into v_message
    from public.outreach_messages m
    join public.organisations o on o.id = m.organisation_id
   where m.id = p_message_id
     for update of m;

  if v_message.id is null then
    raise exception 'that draft could not be found'
      using errcode = 'P0002';
  end if;

  -- Authorisation re-checked inside the SECURITY DEFINER body: the CAM who owns
  -- the client (or owns the draft), or an admin. Everyone else is refused here —
  -- never silently no-oped the way a direct RLS-scoped UPDATE would be.
  if not (
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or v_message.sent_by_user_id = v_actor
  ) then
    raise exception 'only the client''s owner or an admin may send this draft'
      using errcode = '42501';
  end if;

  -- Suppression at point-of-send, re-read now rather than trusting the page load
  -- (same rule as the server action's own check — this one holds even against a
  -- future second caller that forgets theirs).
  if exists (
    select 1
      from public.suppressions s
     where s.organisation_id = v_message.organisation_id
       and s.status = 'active'
  ) then
    raise exception 'this client is suppressed; outreach is blocked'
      using errcode = 'P0001';
  end if;

  -- F128: the branch-wide daily cap, enforced atomically. Locking the singleton
  -- limit row for update is what closes the two-CAM race: a second concurrent
  -- caller's SELECT below blocks here until the first caller's whole
  -- transaction (this function call) commits or rolls back, so by the time it
  -- counts, the first caller's claim — or its refusal — is already visible.
  select daily_limit into v_daily_limit
    from public.outreach_daily_send_limit
   where id = true
     for update;

  -- Mirrors DEFAULT_OUTREACH_DAILY_SEND_LIMIT (daily-send-limit.ts): fail
  -- toward still-enforced, never toward skipping the check, if the seeded
  -- singleton row is ever somehow missing.
  v_daily_limit := coalesce(v_daily_limit, 250);
  v_today_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  select count(*) into v_today_count
    from public.outreach_messages
   where (send_status = 'sent' and sent_at >= v_today_start)
      or (send_claimed_at is not null and send_claimed_at >= v_today_start);

  if v_today_count >= v_daily_limit then
    raise exception 'the daily outreach sending limit (%) has been reached (% sent or in flight today)',
      v_daily_limit, v_today_count
      using errcode = 'P0003';
  end if;

  -- The atomic claim. Only matches an unclaimed, still-unsent draft (or one whose
  -- claim went stale), so exactly one of N concurrent callers gets true.
  update public.outreach_messages
     set send_claimed_at = now()
   where id = v_message.id
     and send_status = 'draft'
     and (
       send_claimed_at is null
       or send_claimed_at < now() - public.send_claim_staleness_window()
     )
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

comment on function public.claim_outreach_send(uuid) is
  'F123/F128: atomically claim a draft for sending. Returns true once per unsent '
  'draft (false for everyone else until the claim goes stale or is released), '
  'refuses non-owners with 42501, suppressed clients with P0001, and a reached '
  'branch-wide daily send cap with P0003 — all before any provider call. Not '
  'audited — the audited transition is mark_outreach_sent.';

create or replace function public.schedule_outreach_send(
  p_message_id uuid,
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

  if not (
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or v_message.sent_by_user_id = v_actor
  ) then
    raise exception 'only the client''s owner or an admin may schedule this draft'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.suppressions s
     where s.organisation_id = v_message.organisation_id
       and s.status = 'active'
  ) then
    raise exception 'this client is suppressed; outreach is blocked'
      using errcode = 'P0001';
  end if;

  update public.outreach_messages m
     set sent_by_user_id  = v_actor,
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
      'subject', v_row.subject
    )
  );

  return v_row.id;
end;
$$;

comment on function public.schedule_outreach_send(uuid, timestamptz) is
  'F126: queues a reviewed outreach email for future delivery — the only ordinary '
  'write path for draft→scheduled, conditional on send_status=''draft'', '
  'authorisation- and suppression-rechecked inside, and audited in the same '
  'transaction per docs/audit-log-pattern.md. Records the scheduler as '
  'sent_by_user_id so attribution survives until the worker delivers. Takes no '
  'content parameters — reviewed subject/body are saved by the Server Action '
  'through the sanitizing app paths first.';

create or replace function public.mark_outreach_sent(
  p_message_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_recipient_email text,
  p_score_snapshot jsonb default null
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

  perform public.insert_score_snapshot(p_message_id, v_message.organisation_id, p_score_snapshot);

  return v_sent;
end;
$$;
