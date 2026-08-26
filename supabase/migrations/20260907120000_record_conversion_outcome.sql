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
-- ONE CONVERSION PER CLIENT, EVER
--
-- A partial unique index backs the rule that F150 states outright: converted is
-- a final, successful outcome, reverted only to correct a genuine mistake. A
-- genuine-mistake revert followed by a re-conversion hits ON CONFLICT DO NOTHING
-- — a silent no-op, same convention as setting the status a client is already
-- on — rather than double-counting in every future conversion metric.
--
-- BACKFILL
--
-- Clients already sitting on 'converted' at migration time get their outcome row
-- too (attributed to their most recent sent email), so the tracked data and the
-- dashboard count derived from outreach_status agree from day one (F143 AC3).
--
-- WHY NO APP CODE CHANGES
--
-- The outcome row commits atomically inside the same transaction as the status
-- flip it records, so /dashboard's converted count (computed from
-- organisations.outreach_status) can never disagree with the tracked data.
--
-- Schema change approval record (SOP §7):
--   Change        | Partial unique index on OUTCOMES; set_outreach_status and
--                 | set_outreach_status_bulk also record a 'converted' OUTCOMES
--                 | row; backfill for existing converted clients.
--   Reason        | F143 Track Conversion — successful outreach must be
--                 | measurable and attributable to an attempt/CAM.
--   Compatibility | Purely additive writes on existing transitions. The index
--                 | only rejects a second 'converted' OUTCOMES row per client —
--                 | which no feature wants (it would double-count). Existing
--                 | direct CAM/admin inserts via the outcomes policies are
--                 | unaffected unless they duplicate a conversion.
--   Data migration| Backfill of clients already on 'converted' (see above).
--   Security      | No new grants, policies or RPCs. The insert runs inside the
--                 | existing SECURITY DEFINER RPCs, which bypass RLS exactly as
--                 | their audit_log writes already do; permission checking is
--                 | unchanged. No new audit action — the status change itself
--                 | stays audited as before.
--   Documentation | Data Model tab 07 already projects OUTCOMES; function
--                 | comments updated here. Approved by Bashir (PM), 26 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260907120000_record_conversion_outcome.down.sql
--   The rollback restores both functions to their pre-migration bodies and drops
--   the index, but deliberately RETAINS the recorded outcome rows: they are ground
--   truth about real-world outcomes, indistinguishable from rows a CAM recorded
--   by hand through the outcomes policies, and deleting them would destroy user
--   data to reverse a schema change.

-- ---------------------------------------------------------------------------
-- One conversion per client, ever
-- ---------------------------------------------------------------------------

create unique index outcomes_one_conversion_per_client
  on public.outcomes (organisation_id)
  where outcome_type = 'converted';

comment on index public.outcomes_one_conversion_per_client is
  'F143: a client converts once. Reverting to correct a mistake and converting '
  'again is absorbed by ON CONFLICT DO NOTHING in set_outreach_status, never a '
  'second row that would double-count in conversion metrics.';

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
  -- was never emailed). One per client ever — see outcomes_one_conversion_per_client.
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
  'email, once per client ever. A reason-required admin override is a separate, '
  'future RPC (override_outreach_status, F224) — this one is unconditional within '
  'permission.';

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
  -- recent sent email, deduped by outcomes_one_conversion_per_client. It executes
  -- unconditionally like every data-modifying CTE, but inserts nothing unless the
  -- target status is 'converted'.
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
  'recent sent email, once per client ever.';

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
