-- Migration: enforce_daily_send_limit_atomically
-- Story: F128 (#355) — Sending Limit Protection. Fixes a review finding on PR #516
-- (mkimari): both send paths checked today's sent count with a plain SELECT, then
-- sent separately. Two concurrent sends could each read a count one under the
-- limit and both proceed, taking the branch mailbox's total one over.
--
-- WHAT THIS CHANGES:
--
--   1. claim_outreach_send(message_id) (20260901110000) now also refuses the
--      claim (returns false, same signal as an already-claimed draft) once
--      today's sent-or-claimed-in-flight count has reached the configured
--      daily_limit — except it raises with errcode P0003 for that specific
--      case, so the caller can show the daily-limit message rather than the
--      generic "already being sent" one. The `for update` lock taken on the
--      OUTREACH_DAILY_SEND_LIMIT singleton row is what makes this safe: two
--      concurrent callers serialize on that lock, so the second caller's count
--      always includes the first caller's already-committed claim (or its
--      absence, once the first caller's claim failed or the daily check
--      itself refused).
--
--   2. New claim_scheduled_outreach_send(message_id, claimed_at), service_role
--      only, folding the scheduled-delivery worker's own raw UPDATE claim
--      (scheduled-worker.ts, F129) and F128's daily check into one atomic
--      SECURITY DEFINER call for the same reason: splitting "check the cap"
--      and "claim this message" into two separate calls cannot be made
--      atomic here — each RPC call is its own transaction, so a lock cannot
--      be held open between them. Returns text ('claimed' |
--      'daily_limit_reached' | 'lost_claim') rather than boolean, since the
--      worker needs to tell a transient per-CAM-style block (reported in its
--      run summary) apart from an ordinary lost per-message race (already
--      silent before this change).
--
-- WHY NOT AN ADVISORY LOCK: OUTREACH_DAILY_SEND_LIMIT is already a singleton
-- row (id pinned to true) that every daily-limit read already touches — locking
-- it directly with `for update` is the same serialization an advisory lock would
-- give, without inventing a new lock key to keep in sync with anything.
--
-- Schema change approval record (SOP §7):
--   Change        | claim_outreach_send(uuid): add an atomic daily-limit check
--                 | (same signature/return type, additive only). Add
--                 | claim_scheduled_outreach_send(uuid, timestamptz).
--   Reason        | PR #516 review (mkimari) — the prior two-step check-then-
--                 | send could let concurrent sends exceed the configured
--                 | daily cap.
--   Compatibility | claim_outreach_send: same signature, same return type,
--                 | same authorisation/suppression checks — its one existing
--                 | caller (outreach-actions.ts, updated in this PR) needs no
--                 | signature change, only to read the new P0003 case.
--                 | claim_scheduled_outreach_send is new; its one caller
--                 | (scheduled-worker.ts, updated in this PR) replaces the raw
--                 | UPDATE it used before.
--   Data migration| None.
--   Security      | Both SECURITY DEFINER, search_path pinned.
--                 | claim_outreach_send keeps its existing active-user +
--                 | ownership + suppression checks verbatim.
--                 | claim_scheduled_outreach_send follows the
--                 | mark_outreach_send_failed / mark_scheduled_outreach_delivered
--                 | precedent (20260903140000 / 20260909090000): auth.uid() must
--                 | be null, EXECUTE granted to service_role only.
--   Documentation | No new table/column; docs/rls-permission-matrix.md's
--                 | existing §2 entry for claim_outreach_send still applies
--                 | unchanged. claim_scheduled_outreach_send follows the same
--                 | matrix entry as mark_scheduled_outreach_delivered.
--
-- Reversibility: paired rollback in
--   ../rollback/20260913100100_enforce_daily_send_limit_atomically.down.sql

-- ---------------------------------------------------------------------------
-- claim_outreach_send — now also enforces the daily cap atomically
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

-- ---------------------------------------------------------------------------
-- claim_scheduled_outreach_send — the scheduled-worker equivalent
-- ---------------------------------------------------------------------------
create function public.claim_scheduled_outreach_send(
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
  -- Definer bypasses RLS, so authorise explicitly: this belongs to the
  -- scheduled-delivery worker, which runs as service_role (null auth.uid()) —
  -- same line mark_outreach_send_failed / mark_scheduled_outreach_delivered
  -- draw. A signed-in user claims a send through claim_outreach_send instead.
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

  -- F128: same atomic daily-cap check claim_outreach_send performs for the
  -- manual send path — the singleton row's lock is what two concurrent claims
  -- (scheduler vs. scheduler, or scheduler vs. a manual send) serialize on.
  select daily_limit into v_daily_limit
    from public.outreach_daily_send_limit
   where id = true
     for update;

  v_daily_limit := coalesce(v_daily_limit, 250);
  v_today_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  select count(*) into v_today_count
    from public.outreach_messages
   where (send_status = 'sent' and sent_at >= v_today_start)
      or (send_claimed_at is not null and send_claimed_at >= v_today_start);

  if v_today_count >= v_daily_limit then
    return 'daily_limit_reached';
  end if;

  -- Conditional on still-scheduled AND unclaimed (or claim gone stale), exactly
  -- like the raw UPDATE this replaces. p_claimed_at is this run's own claim
  -- token (nowIso), the same value markSent later pins against.
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
  'or cancelled it — silent, same as before F128).';

revoke execute on function public.claim_scheduled_outreach_send(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_scheduled_outreach_send(uuid, timestamptz) to service_role;
