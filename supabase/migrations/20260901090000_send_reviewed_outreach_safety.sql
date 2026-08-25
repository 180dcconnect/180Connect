-- Migration: send_reviewed_outreach_safety
-- Sequence: addition (needs public.outreach_messages, public.organisations,
--   public.suppressions, public.audit_log, app.is_admin, app.is_active_user).
--   Not a numbered step — RPC migrations are not rows in Data Model tab 11,
--   following set_outreach_status / create_claim_organisation_rpc.
-- Story: F123 (#120) — Send Reviewed Email. Closes the review findings on PR #458:
--   unauthorised sender, unaudited status transition, double-send race.
-- Spec: docs/audit-log-pattern.md; docs/rls-permission-matrix.md §2/§3.2
--
-- WHAT THIS CHANGES:
--   1. Adds OUTREACH_MESSAGES.send_claimed_at (timestamptz, nullable) — an atomic
--      send claim. Two CAMs hitting "Send reviewed email" on the same draft at the
--      same moment must not both reach Gmail: the first claim wins, the second gets
--      a clear "no longer an unsent draft" refusal BEFORE any provider call. The
--      claim self-heals after CLAIM_STALENESS_WINDOW so a crashed browser tab can
--      never permanently lock a draft.
--
--   2. claim_outreach_send(message_id): re-checks authorisation INSIDE the function
--      (SECURITY DEFINER bypasses RLS, per audit-log-pattern.md §2), re-checks
--      suppression at point-of-send, then flips the claim atomically and reports
--      whether this caller won it. No audit row here by design: a claim is a
--      transient internal lock, not a user-visible state change — the audited
--      transition is draft→sent below.
--
--   3. mark_outreach_sent(message_id, provider ids): the ONLY ordinary write path
--      for draft→sent. Conditional on send_status='draft' (a lost race or resend of
--      an already-sent message raises instead of silently matching zero rows), and
--      inserts the audit_log row in the same transaction, per
--      docs/audit-log-pattern.md §1/§3. Direct UPDATE already cannot do this:
--      outreach_messages_update_own_draft lets a non-owner's UPDATE match zero rows
--      silently while application code carried on to Gmail — the exact hole this
--      closes.
--
-- WHY NOT JUST ASSERT ROW COUNTS FROM THE SERVER ACTION: supabase-js hides rows-
-- affected behind .single()/.limit(1) conventions that are easy to forget at a
--   call site (this PR is the proof). Enforcing it in one reviewed Postgres function
--   means every future caller inherits the guarantee; the action still asserts its
--   own single-row results as belt-and-braces.
--
-- Schema change approval record (SOP §7):
--   Change        | Add OUTREACH_MESSAGES.send_claimed_at (timestamptz, nullable).
--               | Add claim_outreach_send(uuid) and mark_outreach_sent(uuid,text,text)
--               | SECURITY DEFINER RPCs.
--   Reason        | F123 AC4 ("unauthorised sender" testing case must be BLOCKED,
--               | not silently succeed at the provider); DoD "sending impossible
--               | without explicit human approval" needs an audited, atomic
--               | transition to prove it.
--   Compatibility | New nullable column — no backfill; existing rows read as
--               | unclaimed. No existing query writes or selects it.
--   Security      | Both RPCs are SECURITY DEFINER with search_path pinned, both
--               | re-check active-user + ownership + suppression inside the body;
--               | EXECUTE revoked from public/anon, granted to authenticated.
--   Documentation | Data Model tab 07: outreach_messages is not yet projected in
--               | docs/data-model/ on dev (neither are client_booklets etc.), so
--               | there is no generated file to update in this PR. The spreadsheet
--               | row for send_claimed_at should be added at the next projection
--               | refresh; noted here so the gap is deliberate, not missed.
--   Approved by   | Bashir (Project Leader), 25 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260901090000_send_reviewed_outreach_safety.down.sql

-- ---------------------------------------------------------------------------
-- The claim column
-- ---------------------------------------------------------------------------
alter table public.outreach_messages
  add column send_claimed_at timestamptz;

comment on column public.outreach_messages.send_claimed_at is
  'F123: set by claim_outreach_send while a reviewed send is in flight, cleared when '
  'the attempt ends without delivery. A non-null value inside '
  'send_claim_staleness_window() means another browser holds the send; claims older '
  'than that window are stale and may be reclaimed, so a crashed client cannot lock '
  'a draft forever.';

create or replace function public.send_claim_staleness_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '5 minutes';
$$;

comment on function public.send_claim_staleness_window() is
  'How long a send claim blocks re-sending the same draft. Short by design: it only '
  'has to cover one users.messages.send round trip plus timeout, not human thinking '
  'time. Tune here, not in callers.';

-- ---------------------------------------------------------------------------
-- claim_outreach_send — win the right to call Gmail for this draft, atomically
-- ---------------------------------------------------------------------------
create or replace function public.claim_outreach_send(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_message  record;
  v_claimed  uuid;
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
  'F123: atomically claim a draft for sending. Returns true once per unsent draft '
  '(false for everyone else until the claim goes stale or is released), refuses '
  'non-owners with 42501 and suppressed clients outright. Not audited — the audited '
  'transition is mark_outreach_sent.';

-- ---------------------------------------------------------------------------
-- mark_outreach_sent — the audited draft→sent transition
-- ---------------------------------------------------------------------------
create or replace function public.mark_outreach_sent(
  p_message_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text
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
         scheduled_at = null
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
      'provider_thread_id', p_provider_thread_id
    )
  );

  return v_sent;
end;
$$;

comment on function public.mark_outreach_sent(uuid, text, text) is
  'F123: records a delivered outreach email — the only ordinary write path for '
  'draft→sent, conditional on send_status=''draft'' and audited in the same '
  'transaction per docs/audit-log-pattern.md. Raises if the draft was already sent; '
  'the pipeline status change itself stays with set_outreach_status (its own audited '
  'RPC).';

revoke execute on function public.claim_outreach_send(uuid) from public;
revoke execute on function public.claim_outreach_send(uuid) from anon;
grant execute on function public.claim_outreach_send(uuid) to authenticated;

revoke execute on function public.mark_outreach_sent(uuid, text, text) from public;
revoke execute on function public.mark_outreach_sent(uuid, text, text) from anon;
grant execute on function public.mark_outreach_sent(uuid, text, text) to authenticated;
