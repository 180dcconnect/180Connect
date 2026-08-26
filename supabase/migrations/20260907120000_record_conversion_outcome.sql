-- Migration: record_conversion_outcome
-- Sequence: addition (needs public.outcomes, public.outreach_messages,
--   public.organisations, public.audit_log, public.app helpers).
-- Stories: F143 (#138) Track Conversion. Feeds F025 Converted Clients Count,
--   F206/F207/F210 analytics, and F098's future training dataset.
--
-- WHAT THIS DOES
--
-- A conversion is recorded the moment a client's pipeline status is set to
-- 'converted' — the same status-change action a CAM already performs — not by a
-- separate manual "log a conversion" step (F143 AC1; definition signed off by the
-- PM, 26 Aug 2026). Both ordinary write paths are covered:
--
--   * set_outreach_status        — the single change (F145)
--   * set_outreach_status_bulk   — the bulk bar on /clients (F064)
--
-- Direct UPDATE on organisations.outreach_status is already revoked from
-- authenticated, so these two RPCs are every conversion there is.
--
-- THE RECORD ITSELF (F143 AC2)
--
-- Each conversion becomes one row in public.outcomes:
--
--   outcome_type         'converted'
--   outreach_message_id  the most recent SENT email to that client, so the
--                        conversion can be tied back to a specific attempt;
--                        null when the client was never emailed (a manual entry
--                        or an imported relationship) — a null is a fact, not a
--                        gap to fill with guesswork
--   recorded_by_user_id  the actor who made the status change
--
-- AT MOST ONE CONVERSION ROW PER CLIENT AT ANY TIME
--
-- A partial unique index caps OUTCOMES at one 'converted' row per client, which
-- is all consistency requires now that the row tracks *current* state:
--
--   * converting            inserts (ON CONFLICT DO NOTHING absorbs any race or
--                           duplicate)
--   * reverting             DELETES the row — see below
--   * converting again      inserts a fresh one
--
-- BACKFILL
--
-- Clients already sitting on 'converted' at migration time get their outcome row
-- too (attributed to their most recent sent email), so the tracked data and the
-- dashboard count derived from outreach_status agree from day one (F143 AC3).
--
-- REVERT DELETES THE ROW (F143 AC3, PM ruling 26 Aug 2026)
--
-- The dashboard's converted count is computed from organisations.outreach_status
-- — clients CURRENTLY converted. The tracked data implements the same definition:
-- moving a client off 'converted' deletes its 'converted' OUTCOMES row in the
-- same transaction, so the two sides cannot diverge even through a genuine-
-- mistake revert. The history is not lost — the revert's own 'status_changed'
-- audit row plus a 'conversion_outcome_deleted' entry preserve that a conversion
-- existed and was withdrawn, which is where any future lifetime-conversions
-- metric must look instead of OUTCOMES.
--
-- CONVERSIONS ARE SYSTEM-MANAGED, NOT HAND-LOGGED
--
-- The pre-existing F157 policies let a CAM hand-insert any OUTCOMES row,
-- including 'converted' for a client whose status says otherwise — a second
-- write path that would break the alignment above. This migration closes it:
-- CAMs can no longer insert or amend 'converted' rows at all (other outcome
-- types are untouched); admins keep full override. The RPCs are the only
-- ordinary way a conversion row comes into existence.
--
-- WHY NO APP CODE CHANGES
--
-- The insert and the delete commit atomically inside the same transactions as
-- the status flips that cause them, so /dashboard's converted count (computed
-- from organisations.outreach_status) can never disagree with the tracked data.
--
-- Schema change approval record (SOP §7):
--   Change        | Partial unique index on OUTCOMES; set_outreach_status and
--                 | set_outreach_status_bulk record a 'converted' OUTCOMES row
--                 | on converting and DELETE it (audited) on reverting;
--                 | outcomes_insert_cam / outcomes_update_own tightened to bar
--                 | CAMs from writing 'converted' rows; backfill for existing
--                 | converted clients.
--   Reason        | F143 Track Conversion — successful outreach must be
--                 | measurable and attributable to an attempt/CAM, and the
--                 | dashboard must agree with the tracked data under every
--                 | reachable transition (PM ruling on #138, 26 Aug 2026).
--   Compatibility | Additive writes on existing transitions; the only removed
--                 | capability is a CAM hand-logging 'converted', which no UI
--                 | exercises (the app has always converted via the RPCs) and
--                 | which duplicated what the RPC now records automatically.
--   Data migration| Backfill of clients already on 'converted' (see above).
--   Security      | The insert/delete run inside the existing SECURITY DEFINER
--                 | RPCs, bypassing RLS exactly as their audit_log writes
--                 | already do. One new audit action token,
--                 | 'conversion_outcome_deleted', follows the established
--                 | past-tense convention ('role_changed', 'ownership_assigned').
--   Documentation | Data Model tab 07 already projects OUTCOMES; function
--                 | comments updated here. Approved by Bashir (PM), 26 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260907120000_record_conversion_outcome.down.sql
--   The rollback restores both functions to their pre-migration bodies, restores
--   the pre-F143 outcomes policies, and drops the index. It deliberately RETAINS
--   the outcome rows present at rollback time (one per currently-converted
--   client): ground truth about real-world outcomes, indistinguishable from rows
--   a CAM recorded by hand through the outcomes policies, and deleting them
--   would destroy user data to reverse a schema change. Reverts that happened
--   while this migration was live are visible only in the audit trail.

-- ---------------------------------------------------------------------------
-- At most one conversion row per client at any time
-- ---------------------------------------------------------------------------

create unique index outcomes_one_conversion_per_client
  on public.outcomes (organisation_id)
  where outcome_type = 'converted';

comment on index public.outcomes_one_conversion_per_client is
  'F143: a client has at most one ''converted'' OUTCOMES row at a time. The RPCs '
  'insert it on converting, delete it (audited) on reverting, and insert a fresh '
  'one on converting again; ON CONFLICT DO NOTHING absorbs any duplicate that '
  'races or a redundant admin hand-insert.';

-- ---------------------------------------------------------------------------
-- set_outreach_status — single change now also records a conversion
-- ---------------------------------------------------------------------------

create or replace function public.set_outreach_status(
  p_organisation_id uuid,
  p_new_status public.outreach_status
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_org    record;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select o.id, o.owner_id, o.outreach_status into v_org
    from public.organisations o
   where o.id = p_organisation_id
     for update;

  if v_org.id is null then
    raise exception 'that client could not be found'
      using errcode = 'P0002';
  end if;

  -- Permission restriction (F145 testing notes): the CAM who owns this client, or
  -- an admin. A CAM who does not yet own the client claims it first
  -- (claim_organisation) rather than setting its status.
  if not (app.is_admin() or v_org.owner_id = v_actor) then
    raise exception 'only the client''s owner or an admin may change its status'
      using errcode = '42501';
  end if;

  -- No-op changes are not audited — the trail records real transitions only,
  -- same convention as set_user_role / claim_organisation.
  if v_org.outreach_status = p_new_status then
    return v_org.id;
  end if;

  update public.organisations
     set outreach_status = p_new_status
   where id = v_org.id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'status_changed', 'organisations', v_org.id,
    jsonb_build_object('from', v_org.outreach_status, 'to', p_new_status)
  );

  -- F143: landing on 'converted' IS the conversion event. Recorded in the same
  -- transaction, attributed to the most recent sent email (null when the client
  -- was never emailed). At most one row per client at a time — see
  -- outcomes_one_conversion_per_client.
  if p_new_status = 'converted' then
    -- A scalar subquery, not a join: a client never emailed must still get its
    -- outcome row, carrying a null outreach_message_id rather than no row at all.
    insert into public.outcomes
      (organisation_id, outreach_message_id, outcome_type, recorded_by_user_id)
    values (
      v_org.id,
      (
        select om.id
          from public.outreach_messages om
         where om.organisation_id = v_org.id
           and om.sent_at is not null
         order by om.sent_at desc
         limit 1
      ),
      'converted',
      v_actor
    )
    on conflict do nothing;

  -- Moving OFF 'converted' withdraws the tracked conversion in the same
  -- transaction, so the dashboard (currently-converted) and OUTCOMES stay aligned
  -- through genuine-mistake reverts too. The withdrawal is itself audited: the
  -- trail keeps who, when, and which row vanished, so nothing is silently lost.
  elsif v_org.outreach_status = 'converted' then
    with gone as (
      delete from public.outcomes
       where organisation_id = v_org.id
         and outcome_type = 'converted'
      returning id
    )
    insert into public.audit_log
      (actor_user_id, action, target_table, target_id, detail)
    select
      v_actor,
      'conversion_outcome_deleted',
      'outcomes',
      gone.id,
      jsonb_build_object('organisation_id', v_org.id)
      from gone;
  end if;

  return v_org.id;
end;
$$;

comment on function public.set_outreach_status(uuid, public.outreach_status) is
  'F145: the client''s owner (CAM) or an admin sets its pipeline status to any of the '
  'ten F146-F155 values. SECURITY DEFINER so the write and its audit_log row commit '
  'in one transaction; direct UPDATE on organisations.outreach_status is revoked from '
  'authenticated, so this is the only ordinary write path. No-op (same status) is not '
  'an error and is not audited. F143: a move onto ''converted'' additionally records '
  'one OUTCOMES row (outcome_type ''converted''), linked to the most recent sent '
  'email; a move off ''converted'' deletes that row and writes a '
  '''conversion_outcome_deleted'' audit entry, keeping OUTCOMES aligned with the '
  'dashboard''s currently-converted count. A reason-required admin override is a '
  'separate, future RPC (override_outreach_status, F224) — this one is '
  'unconditional within permission.';

-- ---------------------------------------------------------------------------
-- set_outreach_status_bulk — batch changes record conversions too
-- ---------------------------------------------------------------------------

create or replace function public.set_outreach_status_bulk(
  p_organisation_ids uuid[],
  p_new_status public.outreach_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := (select auth.uid());
  v_ids       uuid[];
  v_requested int;
  v_found     int;
  v_denied    int;
  v_changed   int;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  -- Duplicates and nulls are the caller's problem to not send, but they are also
  -- harmless to absorb: deduping here means the count reported back matches the
  -- number of distinct clients affected, which is the number AC2's confirmation
  -- step showed the CAM.
  select coalesce(array_agg(distinct candidate), '{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_organisation_ids, '{}'::uuid[])) as candidate
   where candidate is not null;

  v_requested := coalesce(array_length(v_ids, 1), 0);

  -- F064 testing notes: "zero selected records". An empty selection is a mistake,
  -- not a no-op to swallow silently — the CAM pressed apply expecting something.
  if v_requested = 0 then
    raise exception 'select at least one client before changing status'
      using errcode = '22023';
  end if;

  if v_requested > 500 then
    raise exception 'a bulk status change covers at most 500 clients at once'
      using errcode = '22023';
  end if;

  -- Lock every target row up front, ordered by id. The order is what stops two
  -- concurrent bulk updates over overlapping selections from deadlocking by
  -- taking the same rows in opposite orders; the lock itself is what makes the
  -- permission check below and the write beneath it describe the same rows.
  select count(*)
    into v_found
    from (
      select o.id
        from public.organisations o
       where o.id = any(v_ids)
       order by o.id
         for update
    ) locked;

  if v_found <> v_requested then
    raise exception 'one or more of those clients could not be found'
      using errcode = 'P0002';
  end if;

  -- Same rule as set_outreach_status, applied to the whole batch: owner or admin.
  -- Reported as a count, never as a list of names — the caller already knows
  -- which clients it selected, and naming rows back at a request that was
  -- refused would hand a crafted call a way to probe ownership.
  if not app.is_admin() then
    select count(*)
      into v_denied
      from public.organisations o
     where o.id = any(v_ids)
       and o.owner_id is distinct from v_actor;

    if v_denied > 0 then
      raise exception 'you can only change the status of clients you own (% of % selected are not yours)',
        v_denied, v_requested
        using errcode = '42501';
    end if;
  end if;

  -- One statement, so the audit rows are written from the same snapshot the
  -- update reads: `snapshot` sees pre-update values even though `updated` runs in
  -- the same statement, which is how `from` stays the status the client was
  -- actually on. Rows already on the target status never enter `snapshot`, so
  -- they are neither written nor audited.
  --
  -- F143: `recorded` runs off the same snapshot, so exactly the rows that really
  -- moved onto 'converted' get an OUTCOMES row — each attributed to its most
  -- recent sent email, capped by outcomes_one_conversion_per_client. It executes
  -- unconditionally like every data-modifying CTE, but inserts nothing unless the
  -- target status is 'converted'. Symmetrically, `retracted` deletes the tracked
  -- conversion of rows moving OFF 'converted' (audited in `retraction_audited`),
  -- so a bulk revert leaves OUTCOMES agreeing with the dashboard exactly as a
  -- single revert does.
  with snapshot as (
    select o.id, o.outreach_status as from_status
      from public.organisations o
     where o.id = any(v_ids)
       and o.outreach_status is distinct from p_new_status
  ),
  updated as (
    update public.organisations o
       set outreach_status = p_new_status
      from snapshot s
      where o.id = s.id
    returning o.id
  ),
  audited as (
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    select
      v_actor,
      'status_changed',
      'organisations',
      s.id,
      jsonb_build_object(
        'from', s.from_status,
        'to', p_new_status,
        -- Marks the row as part of a batch without inventing a second action
        -- token: 'trigger' is the existing key for "what caused this", already
        -- carrying 'self_claim' and 'bulk_assign' elsewhere in the trail.
        'trigger', 'bulk_update',
        'batch_size', v_requested
      )
      from snapshot s
    returning 1
  ),
  recorded as (
    insert into public.outcomes
      (organisation_id, outreach_message_id, outcome_type, recorded_by_user_id)
    select s.id,
           latest_message.id,
           'converted',
           v_actor
      from snapshot s
           left join lateral (
             select om.id
               from public.outreach_messages om
              where om.organisation_id = s.id
                and om.sent_at is not null
              order by om.sent_at desc
              limit 1
           ) latest_message on true
     where p_new_status = 'converted'
    on conflict do nothing
    returning 1
  ),
  retracted as (
    delete from public.outcomes o
     using snapshot s
     where o.organisation_id = s.id
       and o.outcome_type = 'converted'
       and s.from_status = 'converted'
       and p_new_status <> 'converted'
    returning o.id, o.organisation_id
  ),
  retraction_audited as (
    insert into public.audit_log
      (actor_user_id, action, target_table, target_id, detail)
    select
      v_actor,
      'conversion_outcome_deleted',
      'outcomes',
      r.id,
      jsonb_build_object('organisation_id', r.organisation_id)
      from retracted r
    returning 1
  )
  select count(*) into v_changed from updated;

  return jsonb_build_object(
    'requested', v_requested,
    'changed', v_changed,
    'unchanged', v_requested - v_changed
  );
end;
$$;

comment on function public.set_outreach_status_bulk(uuid[], public.outreach_status) is
  'Same permission rule as F145''s set_outreach_status (the client''s owner or an '
  'admin), applied to a whole batch of up to 500 in one atomic statement. F143: '
  'rows moved onto ''converted'' each record one OUTCOMES row, linked to the most '
  'recent sent email; rows moved off ''converted'' have theirs deleted (audited).';

-- ---------------------------------------------------------------------------
-- Conversions are system-managed: CAMs can no longer hand-write 'converted'
-- ---------------------------------------------------------------------------

-- F157 let a CAM insert any OUTCOMES row for themselves, including 'converted'
-- for a client whose pipeline status says otherwise — a manual log path that
-- would desync OUTCOMES from the dashboard count this migration aligns them.
-- CAMs keep every other outcome type exactly as before; admins are untouched.

drop policy if exists outcomes_insert_cam on public.outcomes;

create policy outcomes_insert_cam on public.outcomes
  for insert to authenticated
  with check (app.is_active_user()
              and app.is_cam()
              and recorded_by_user_id = auth.uid()
              and outcome_type <> 'converted');

comment on policy outcomes_insert_cam on public.outcomes is
  'F157, tightened by F143: a CAM records their own judgements, but ''converted'' '
  'is system-managed — it is written and withdrawn only by the status RPCs, so a '
  'hand-logged conversion can never disagree with the pipeline. Admins retain the '
  'override via outcomes_insert_admin.';

drop policy if exists outcomes_update_own on public.outcomes;

create policy outcomes_update_own on public.outcomes
  for update to authenticated
  using (app.is_active_user()
         and app.is_cam()
         and coalesce(recorded_by_user_id = auth.uid(), false)
         and outcome_type <> 'converted')
  with check (app.is_active_user()
              and app.is_cam()
              and coalesce(recorded_by_user_id = auth.uid(), false)
              and outcome_type <> 'converted');

comment on policy outcomes_update_own on public.outcomes is
  'F157, tightened by F143: a CAM edits their own outcome rows, but never a '
  '''converted'' one (those belong to the RPCs) and never renames another type '
  'into ''converted''. Admins retain the override via outcomes_update_admin.';

-- ---------------------------------------------------------------------------
-- Backfill — conversions that predate tracking
-- ---------------------------------------------------------------------------

insert into public.outcomes
  (organisation_id, outreach_message_id, outcome_type, recorded_by_user_id)
select o.id,
       latest_message.id,
       'converted',
       o.owner_id
  from public.organisations o
       left join lateral (
         select om.id
           from public.outreach_messages om
          where om.organisation_id = o.id
            and om.sent_at is not null
          order by om.sent_at desc
          limit 1
       ) latest_message on true
 where o.outreach_status = 'converted'
on conflict do nothing;
