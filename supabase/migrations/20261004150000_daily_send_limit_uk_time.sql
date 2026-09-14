-- Migration: daily_send_limit_uk_time
-- Story: Outreach sending limit — reset on UK calendar day, not UTC
--
-- The daily cap was designed with "UTC midnight" as the reset point, but this
-- branch operates exclusively in the UK. UTC = UK time in winter but UTC+1 in
-- summer (BST), meaning the cap was resetting at 01:00 UK time during summer —
-- confusing for admins reading "X of 250 sent today" late at night.
--
-- WHAT THIS CHANGES:
--
--   Both RPCs that enforce the cap replace:
--
--     date_trunc('day', now() at time zone 'utc') at time zone 'utc'
--
--   with:
--
--     date_trunc('day', now() at time zone 'Europe/London')
--                       at time zone 'Europe/London'
--
--   Postgres's built-in timezone database (from tzdata, managed by the
--   Supabase platform) handles BST/GMT transitions automatically, so this
--   needs no application-side logic.
--
--   The helper function dailySendWindowStart() in TypeScript is updated
--   separately (same PR) to produce a matching window for the display counter.
--
-- WHY CREATE OR REPLACE (not a new function):
--   Identical signature, identical return type — this is a pure behavioural
--   change inside the body, not a contract change. No caller needs updating.
--
-- Schema change approval record (SOP §7):
--   Change        | claim_outreach_send(uuid),
--                 | claim_scheduled_outreach_send(uuid, timestamptz):
--                 | window boundary changes from UTC to Europe/London.
--   Reason        | Reset should align with UK calendar day, not UTC.
--   Compatibility | Additive-behavioural only: same signatures, same return
--                 | types, same errcode surface. One-hour difference in summer.
--                 | Authorisation predicate untouched (F018 owner-or-admin-or-
--                 | author-while-unowned still enforced inside the claim).
--   Data migration| None.
--   Security      | Both SECURITY DEFINER, search_path unchanged.
--   Documentation | daily-send-limit.ts updated in same PR.
--
-- Reversibility: paired rollback in
--   ../rollback/20261004150000_daily_send_limit_uk_time.down.sql

-- ---------------------------------------------------------------------------
-- claim_outreach_send — reset on UK calendar day
-- ---------------------------------------------------------------------------
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

  -- Authorisation re-checked inside the SECURITY DEFINER body. F018: owning
  -- the DRAFT is no longer enough — the author clause only holds while nobody
  -- owns the client. On a client owned by another CAM only the owner or an
  -- admin may send, matching app.can_contact_organisation().
  -- coalesce: with an unowned client, `org_owner_id = v_actor` is NULL, and an
  -- uncoalesced NULL would make `IF NOT (NULL)` silently ALLOW (three-valued
  -- logic — test 10 of f018_contact_permission.test.sql exists because a draft
  -- of this very migration let any active user send on unowned clients).
  if not coalesce(
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or (v_message.org_owner_id is null and v_message.sent_by_user_id = v_actor),
    false
  ) then
    raise exception 'this client is owned by another CAM; only its owner or an admin may send this draft'
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

  -- F128 daily cap — window now anchored to UK calendar day (Europe/London),
  -- so the counter resets at midnight UK time in both winter (= UTC) and
  -- summer (= UTC+1 / BST).  Postgres's built-in tzdata handles DST.
  select daily_limit into v_daily_limit
    from public.outreach_daily_send_limit
   where id = true
     for update;

  v_daily_limit := coalesce(v_daily_limit, 250);
  v_today_start := date_trunc('day', now() at time zone 'Europe/London')
                   at time zone 'Europe/London';

  select count(*) into v_today_count
    from public.outreach_messages
   where (send_status = 'sent' and sent_at >= v_today_start)
      or (send_claimed_at is not null and send_claimed_at >= v_today_start);

  if v_today_count >= v_daily_limit then
    raise exception 'the daily outreach sending limit (%) has been reached (% sent or in flight today)',
      v_daily_limit, v_today_count
      using errcode = 'P0003';
  end if;

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
  'F123/F018/F128: atomically claim a draft for sending. Returns true once per unsent '
  'draft (false for everyone else until the claim goes stale or is released), '
  'refuses anyone but the client''s owner, an admin, or the draft''s '
  'author ON AN UNOWNED CLIENT with 42501, suppressed clients with P0001, and a '
  'reached branch-wide daily send cap with P0003 — all before any provider call. '
  'Daily window resets at UK midnight (Europe/London, BST/GMT). Not audited — '
  'the audited transition is mark_outreach_sent.';

-- ---------------------------------------------------------------------------
-- claim_scheduled_outreach_send — reset on UK calendar day
-- ---------------------------------------------------------------------------
create or replace function public.claim_scheduled_outreach_send(
  p_message_id uuid,
  p_claimed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row          record;
  v_daily_limit  integer;
  v_today_start  timestamptz;
  v_today_count  bigint;
  v_claimed      uuid;
begin
  if (select auth.uid()) is not null then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select m.id
    into v_row
    from public.outreach_messages m
   where m.id = p_message_id
     for update of m;

  if v_row.id is null then
    return 'lost_claim';
  end if;

  -- F128 daily cap — same UK-day window as claim_outreach_send.
  select daily_limit into v_daily_limit
    from public.outreach_daily_send_limit
   where id = true
     for update;

  v_daily_limit := coalesce(v_daily_limit, 250);
  v_today_start := date_trunc('day', now() at time zone 'Europe/London')
                   at time zone 'Europe/London';

  select count(*) into v_today_count
    from public.outreach_messages
   where (send_status = 'sent' and sent_at >= v_today_start)
      or (send_claimed_at is not null and send_claimed_at >= v_today_start);

  if v_today_count >= v_daily_limit then
    return 'daily_limit_reached';
  end if;

  update public.outreach_messages
     set send_claimed_at = p_claimed_at
   where id = p_message_id
     and send_status = 'scheduled'
     and (
       send_claimed_at is null
       or send_claimed_at < p_claimed_at - public.send_claim_staleness_window()
     )
  returning id into v_claimed;

  if v_claimed is null then
    return 'lost_claim';
  end if;

  return 'claimed';
end;
$$;

comment on function public.claim_scheduled_outreach_send(uuid, timestamptz) is
  'F129/F128: service_role-only atomic claim for the scheduled-delivery worker. '
  'Returns ''claimed'', ''daily_limit_reached'' (the branch-wide cap is exhausted — '
  'transient, reported in the run summary), or ''lost_claim'' (someone else claimed '
  'or cancelled it — silent, same as before F128). '
  'Daily window resets at UK midnight (Europe/London, BST/GMT).';

revoke execute on function public.claim_scheduled_outreach_send(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_scheduled_outreach_send(uuid, timestamptz) to service_role;
