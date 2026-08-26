-- Rollback: align_outcome_taxonomy
-- Reverses supabase/migrations/20260910120000_align_outcome_taxonomy.sql (F144 #139).
--
-- Restores both status RPCs, the policies, and the taxonomy to their exact
-- record_conversion_outcome (#501) state as merged on dev (2b68b81).
--
-- ORDER MATTERS, mirroring the forward migration's constraints in reverse:
--   1. functions back to #501 bodies
--   2. non-conversion mirror rows deleted (no counterpart in the old model)
--   3. CAM policies dropped AGAIN only if present — no: they were already
--      dropped by the forward migration, so the reverse retype can run free;
--      they are restored LAST, after the column holds the old type again
--   4. taxonomy reversed, index swapped back, policies restored
--
-- DELIBERATE RETENTIONS AND DELETIONS:
--   * Mirror rows for clients NOT currently on 'converted' are DELETED: under
--     the old model only conversions were tracked at all, so these rows have no
--     counterpart to map into. They exist solely because F144's backfill and
--     RPCs mirrored other terminal statuses.
--   * Rows for currently-converted clients are retained and reverse-cast;
--     they are ground truth about real-world outcomes and deleting them would
--     destroy user data to reverse a schema change.
--
-- BEST-EFFORT REVERSE MAPPING, BY NECESSITY: the old taxonomy had no value
-- meaning "they replied" and no soft/hard refusal distinction. reply ->
-- referral (both mean engagement via a reply), soft_no / hard_no -> rejected,
-- identity for converted / no_response. If a faithful undo matters, export
-- public.outcomes before rolling back.

-- ---------------------------------------------------------------------------
-- set_outreach_status — back to the #501 body as merged (2b68b81)
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

  if p_new_status = 'converted' then
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
-- set_outreach_status_bulk — back to the #501 body as merged (2b68b81)
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
-- advance_outreach_pipeline_on_send — back to the #503 body as merged (0cd522c)
--
-- Restored verbatim so the rollback returns every writer to its pre-F144
-- shape; under the restored model only 'converted' rows exist and #503's
-- original leaves them alone, which is what that model wants.
-- ---------------------------------------------------------------------------

create or replace function public.advance_outreach_pipeline_on_send(
  p_organisation_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.outreach_status;
  v_next    public.outreach_status;
begin
  -- Lock the row: serializes two near-simultaneous sends so the second sees
  -- the first's committed status and lands on follow_up_sent, never a second
  -- 'initial'.
  select o.outreach_status into v_current
    from public.organisations o
   where o.id = p_organisation_id
     for update;

  if v_current is null then
    -- The message's organisation vanished mid-transaction; there is nothing to
    -- advance and nothing to audit. The caller's own flip already succeeded.
    return;
  end if;

  -- F147 AC1/AC2: the very first send leaves not_contacted; any later send
  -- reads follow_up_sent, whatever the client currently says.
  v_next := case when v_current = 'not_contacted'
                 then 'initial_outreach_sent'::public.outreach_status
                 else 'follow_up_sent'::public.outreach_status end;

  if v_current = v_next then
    return;  -- same-status no-op is not audited (audit-log-pattern.md §5)
  end if;

  update public.organisations
     set outreach_status = v_next
   where id = p_organisation_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    p_actor, 'status_changed', 'organisations', p_organisation_id,
    jsonb_build_object('from', v_current, 'to', v_next)
  );
end;
$$;

comment on function public.advance_outreach_pipeline_on_send(uuid, uuid) is
  'F157 internal: advances a client''s pipeline status after a confirmed send '
  '(not_contacted → initial_outreach_sent, else → follow_up_sent) and writes the '
  'status_changed audit row under the caller''s transaction. Called only by '
  'mark_outreach_sent and mark_scheduled_outreach_delivered; EXECUTE revoked from '
  'every role.';

-- ---------------------------------------------------------------------------
-- Mirror rows without an old-model counterpart
-- ---------------------------------------------------------------------------

delete from public.outcomes o
 where o.outcome_type <> 'converted'
    or o.organisation_id in (
      select org.id from public.organisations org
       where org.outreach_status <> 'converted'
    );

-- ---------------------------------------------------------------------------
-- Taxonomy back to the pre-F144 value set
-- ---------------------------------------------------------------------------

alter type public.outcome_type rename to outcome_type_f144;

create type public.outcome_type as enum
  ('converted', 'no_response', 'rejected', 'follow_up', 'referral');

alter table public.outcomes alter column outcome_type drop default;

alter table public.outcomes
  alter column outcome_type type public.outcome_type
  using (
    case outcome_type::text
      when 'converted'   then 'converted'
      when 'no_response' then 'no_response'
      when 'soft_no'     then 'rejected'
      when 'hard_no'     then 'rejected'
      else 'referral'  -- reply: engagement via a reply, closest old value
    end
  )::public.outcome_type;

drop type public.outcome_type_f144;

comment on type public.outcome_type is
  NULL;

comment on column public.outcomes.outcome_type is
  NULL;

-- ---------------------------------------------------------------------------
-- Index back to the #501 shape
-- ---------------------------------------------------------------------------

drop index if exists public.outcomes_one_outcome_per_type;

create unique index outcomes_one_conversion_per_client
  on public.outcomes (organisation_id)
  where outcome_type = 'converted';

comment on index public.outcomes_one_conversion_per_client is
  'F143: a client has at most one ''converted'' OUTCOMES row at a time. The RPCs '
  'insert it on converting, delete it (audited) on reverting, and insert a fresh '
  'one on converting again; ON CONFLICT DO NOTHING absorbs any duplicate that '
  'races or a redundant admin hand-insert.';

-- ---------------------------------------------------------------------------
-- Policies — restore the CAM paths #501 left in place
--
-- Restored LAST because the forward migration dropped them precisely so the
-- column could be retyped; recreating them any earlier would re-block the
-- ALTER TYPE above.
-- ---------------------------------------------------------------------------

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
