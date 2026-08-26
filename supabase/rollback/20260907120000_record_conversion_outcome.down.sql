-- Rollback: record_conversion_outcome
-- Reverses supabase/migrations/20260907120000_record_conversion_outcome.sql (F143 #138).
--
-- Restores both status RPCs to their pre-migration bodies, restores the pre-F143
-- outcomes_insert_cam / outcomes_update_own policies (CAMs can hand-write
-- 'converted' rows again), and drops the one-conversion-per-client index.
--
-- DELIBERATELY RETAINED: the OUTCOMES rows present at rollback time — one per
-- currently-converted client (reverts under this migration delete the row). They
-- are ground truth about real-world outcomes, indistinguishable from rows a CAM
-- recorded by hand through the outcomes policies, so deleting every
-- outcome_type = 'converted' row would destroy user data to reverse a schema
-- change. If a true undo is required, remove them explicitly and knowingly:
--
--   delete from public.outcomes where outcome_type = 'converted';
--
-- Note that reverts which happened while this migration was live left no
-- OUTCOMES trace — only 'conversion_outcome_deleted' entries in audit_log.
-- The backfill's rows are equally retained; re-running the forward migration is
-- idempotent (the index + ON CONFLICT DO NOTHING), so rollback/apply cycles do
-- not duplicate anything.

-- ---------------------------------------------------------------------------
-- set_outreach_status — back to the pre-F143 body (as on dev at 5de83bd)
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

  return v_org.id;
end;
$$;

comment on function public.set_outreach_status(uuid, public.outreach_status) is
  'F145: the client''s owner (CAM) or an admin sets its pipeline status to any of the '
  'ten F146-F155 values. SECURITY DEFINER so the write and its audit_log row commit '
  'in one transaction; direct UPDATE on organisations.outreach_status is revoked from '
  'authenticated, so this is the only ordinary write path. No-op (same status) is not '
  'an error and is not audited. A reason-required admin override is a separate, '
  'future RPC (override_outreach_status, F224) — this one is unconditional within '
  'permission.';

-- ---------------------------------------------------------------------------
-- set_outreach_status_bulk — back to the pre-F143 body (as on dev at 5de83bd)
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

  select coalesce(array_agg(distinct candidate), '{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_organisation_ids, '{}'::uuid[])) as candidate
   where candidate is not null;

  v_requested := coalesce(array_length(v_ids, 1), 0);

  if v_requested = 0 then
    raise exception 'select at least one client before changing status'
      using errcode = '22023';
  end if;

  if v_requested > 500 then
    raise exception 'a bulk status change covers at most 500 clients at once'
      using errcode = '22023';
  end if;

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
        'trigger', 'bulk_update',
        'batch_size', v_requested
      )
      from snapshot s
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
  'admin), applied to a whole batch of up to 500 in one atomic statement.';

-- ---------------------------------------------------------------------------
-- Index and policies
-- ---------------------------------------------------------------------------

drop index if exists public.outcomes_one_conversion_per_client;

drop policy if exists outcomes_insert_cam on public.outcomes;

create policy outcomes_insert_cam on public.outcomes
  for insert to authenticated
  with check (app.is_active_user()
              and app.is_cam()
              and recorded_by_user_id = auth.uid());

-- F157's policies carried no comment; drop F143's rather than leave it stale.
comment on policy outcomes_insert_cam on public.outcomes is null;

drop policy if exists outcomes_update_own on public.outcomes;

create policy outcomes_update_own on public.outcomes
  for update to authenticated
  using (app.is_active_user()
         and app.is_cam()
         and coalesce(recorded_by_user_id = auth.uid(), false))
  with check (app.is_active_user()
              and app.is_cam()
              and coalesce(recorded_by_user_id = auth.uid(), false));

comment on policy outcomes_update_own on public.outcomes is null;
