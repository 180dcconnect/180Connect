-- Migration: f018_contact_permission_rpc_checks
-- Sequence: addition (needs public.outreach_messages, public.organisations,
--   public.suppressions, public.audit_log, app.is_admin, app.is_active_user).
--   Not a numbered step — RPC migrations are not rows in Data Model tab 11,
--   following send_reviewed_outreach_safety / scheduled_outreach_safety.
-- Story: F018 (#21) — Contact Permission Rules.
--
-- WHAT THIS CHANGES — no schema change; three SECURITY DEFINER RPCs redefined
-- with ONE tightened authorisation predicate:
--
--   claim_outreach_send(uuid)          (from 20260901110000)
--   schedule_outreach_send(uuid,timestamptz) (from 20260902120000)
--   mark_outreach_sent(uuid,text,text,text,jsonb) (from 20260911120000,
--   create_score_snapshots — F097's 5-arg version with p_score_snapshot)
--
-- THE OLD RULE: admin, or the client's owner, or the draft's author. The third
-- clause is the F018 hole: a CAM who authored a draft keeps a standing licence
-- to send it even after the client is reassigned to someone else, and a direct
-- PostgREST caller could ride it past every app-level gate straight to Gmail.
--
-- THE NEW RULE (F018 AC1): admin, or the client's owner, or — ONLY while the
-- client is unowned — the draft's author. Identical semantics to
-- app.can_contact_organisation() (rls_helpers.sql), which backs the RLS insert
-- policies: "Admin yes, CAM only if they own the client or nobody does."
-- Ownership is the sanctioned route to contacting a client another CAM works on
-- (PM decision, Bashir, Aug 2026) — there is deliberately NO per-CAM grant
-- table; request ownership instead.
--
-- Scheduled sends are checked at SCHEDULE time only. Per PM decision a schedule
-- that was permitted when queued is delivered by the cron worker even if
-- ownership changes before it fires (grandfathered); the worker runs as
-- service_role and never had an auth.uid() to check against anyway.
--
-- The app-level gates (assertContactPermission in outreach-actions.ts) run
-- first and give the friendly owner-naming message; these RPC re-checks are
-- the enforcement that survives a bypassed UI (AC1 "blocked, not just hidden").
--
-- Schema change approval record (SOP §7):
--   Change        | Redefine claim_outreach_send, schedule_outreach_send and
--               | mark_outreach_sent with the F018 contact-permission
--               | predicate (draft-author clause now requires an unowned client).
--   Reason        | F018 AC1/AC4: a non-owner CAM must be unable to send —
--               | including by direct API call — even when holding a draft
--               | authored before the client was reassigned.
--   Compatibility | No signature or return-type changes; callers unaffected.
--               | mark_outreach_sent keeps F097's 5-arg (p_score_snapshot)
--               | signature and snapshot behaviour verbatim. Behaviour narrows
--               | only in the case the ticket exists to close (draft author ≠
--               | client owner, client owned elsewhere). The cron delivery path
--               | (service_role, mark_scheduled_outreach_delivered) is untouched
--               | — scheduled sends are grandfathered by design.
--   Security      | All three remain SECURITY DEFINER with search_path pinned;
--               | EXECUTE grants unchanged (authenticated only, where applicable).
--   Documentation | docs/rls-permission-matrix.md §3.4 updated in the same PR.
--   Approved by   | Bashir (Project Manager), 26 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260911130000_f018_contact_permission_rpc_checks.down.sql

-- ---------------------------------------------------------------------------
-- claim_outreach_send — F018 predicate added to the atomic claim
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
  'F123/F018: atomically claim a draft for sending. Returns true once per unsent '
  'draft (false for everyone else until the claim goes stale or is released), '
  'refuses anyone but the client''s owner, an admin, or the draft''s author ON AN '
  'UNOWNED CLIENT with 42501, and suppressed clients outright. Not audited — the '
  'audited transition is mark_outreach_sent.';

-- ---------------------------------------------------------------------------
-- schedule_outreach_send — F018 predicate added to the audited scheduling RPC.
-- This is also the LAST permission check a scheduled email ever passes: per PM
-- decision deliveries are grandfathered, so tightening here (not in the worker)
-- is exactly where the F018 rule must live for the scheduled path.
-- ---------------------------------------------------------------------------
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

  -- Authorisation re-checked inside the SECURITY DEFINER body, under the F018
  -- rule: the client's owner, an admin, or the draft's author while the client
  -- is unowned. Scheduling cannot succeed where sending would refuse.
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
    raise exception 'this client is owned by another CAM; only its owner or an admin may schedule this draft'
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
  'F126/F018: queues a reviewed outreach email for future delivery — the only '
  'ordinary write path for draft→scheduled, conditional on send_status=''draft'', '
  'authorisation- and suppression-rechecked inside, and audited in the same '
  'transaction per docs/audit-log-pattern.md. Records the scheduler as '
  'sent_by_user_id so attribution survives until the worker delivers. F018: the '
  'author clause holds only while the client is unowned; a permitted schedule is '
  'delivered even if ownership later changes (grandfathered, PM decision). Takes '
  'no content parameters — reviewed subject/body are saved by the Server Action '
  'through the sanitizing app paths first.';

-- ---------------------------------------------------------------------------
-- mark_outreach_sent — F018 predicate added to the audited draft→sent flip.
-- Body otherwise IDENTICAL to F097's 20260911120000_create_score_snapshots
-- definition (5-arg with p_score_snapshot): the snapshot capture, pipeline
-- advance and audit row are preserved untouched — only the authorisation
-- predicate and its message change.
-- ---------------------------------------------------------------------------
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

  -- Locked on BOTH rows: the message so the draft→sent flip stays race-free as
  -- before, the organisation so the pipeline advance below cannot interleave
  -- with another send's advance.
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

  -- F018: same rule as claim_outreach_send directly above — recording a send
  -- must be no more reachable than claiming one, or the claim gate is theatre.
  -- coalesce: with an unowned client, `org_owner_id = v_actor` is NULL, and an
  -- uncoalesced NULL would make `IF NOT (NULL)` silently ALLOW (three-valued
  -- logic).
  if not coalesce(
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or (v_message.org_owner_id is null and v_message.sent_by_user_id = v_actor),
    false
  ) then
    raise exception 'this client is owned by another CAM; only its owner or an admin may record this send'
      using errcode = '42501';
  end if;

  -- Conditional on still being a draft: a second invocation raises instead of
  -- recording a second sent state. The pipeline advance and snapshot below only
  -- run on the winning invocation.
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

  -- F157 AC3: status move and recordal share one transaction.
  perform public.advance_outreach_pipeline_on_send(v_message.organisation_id, v_actor);

  -- F097 AC1: the feature context captured before this send lands beside it —
  -- one transaction, so a rolled-back recordal never leaves an orphan snapshot
  -- and a stored send never lacks its vector when the caller built one.
  perform public.insert_score_snapshot(p_message_id, v_message.organisation_id, p_score_snapshot);

  return v_sent;
end;
$$;

comment on function public.mark_outreach_sent(uuid, text, text, text, jsonb) is
  'F123/F116/F157/F097/F018: records a delivered outreach email — conditional '
  'draft→sent flip, audited recipient + pipeline advance, and (when '
  'p_score_snapshot is provided) the client''s point-in-time scoring vector, '
  'ALL in one transaction. A malformed snapshot raises and rolls the whole '
  'recordal back; a null one skips silently. Raises if already recorded as '
  'sent. F018: authorisation matches claim_outreach_send — owner, admin, or '
  'the draft''s author on an unowned client only.';

revoke execute on function public.mark_outreach_sent(uuid, text, text, text, jsonb) from public;
revoke execute on function public.mark_outreach_sent(uuid, text, text, text, jsonb) from anon;
grant execute on function public.mark_outreach_sent(uuid, text, text, text, jsonb) to authenticated;
