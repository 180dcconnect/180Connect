-- Schema change approval record (SOP §7):
--   Change        | Add organisations_outcome_mirror(), fired by two deferred
--                 | constraint triggers on public.organisations, and reconcile
--                 | the existing OUTCOMES rows against current pipeline status.
--   Reason        | OUTCOMES is meant to mirror each client's terminal status
--                 | (F143/F144), but only the three RPCs that set status by
--                 | hand or on send maintained it. Every other writer skipped
--                 | it: mark_organisation_responded (F149 reply detection),
--                 | mark_organisation_no_response (F154 sweep), seed and demo
--                 | scripts, and any service-role update. The dashboard's
--                 | "Converted" card reads pipeline status and its
--                 | "Conversions" tile reads OUTCOMES, so the two disagreed
--                 | (staging: 1 converted, 0 conversions; 11 terminal clients
--                 | with no outcome row). Moving the invariant into the table
--                 | means no present or future writer can break it.
--   Compatibility | Additive. The RPCs keep their own mirror code, and it
--                 | still runs first: the triggers are DEFERRABLE INITIALLY
--                 | DEFERRED, so they fire at commit, find the row already
--                 | correct, and do nothing — no duplicate rows (unique
--                 | organisation_id + outcome_type) and no duplicate
--                 | 'outcome_deleted' audit entries on those paths.
--   Data migration| One-time reconcile below: withdraws outcome rows whose
--                 | client is no longer in that status (audited), and records
--                 | the missing row for every terminal client, dated from the
--                 | audited status change where one exists.
--   Security      | SECURITY DEFINER with an empty search_path, like the RPCs
--                 | it backs up. A trigger function cannot be called over the
--                 | REST RPC endpoint, but EXECUTE is revoked from public,
--                 | anon and authenticated anyway, same defensive pattern as
--                 | 20260923090000.

create or replace function public.organisations_outcome_mirror()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_status public.outreach_status;
  v_want   public.outcome_type;
begin
  -- Deferred to commit, so read the status as it finally stands rather than
  -- trusting NEW: the row may have changed again, or been deleted, since.
  select o.outreach_status into v_status
    from public.organisations o
   where o.id = new.id;

  if v_status is null then
    return null;
  end if;

  -- The same status -> outcome mapping as set_outreach_status: every terminal
  -- token names its outcome except 'responded', which lands as 'reply'.
  v_want := (case
               when v_status = 'responded' then 'reply'
               when v_status::text in ('converted', 'no_response', 'soft_no', 'hard_no') then v_status::text
             end)::public.outcome_type;

  -- Withdraw anything that no longer matches, audited exactly as the RPCs do.
  -- actor_user_id is null for a system writer (sweep, reply detection).
  with gone as (
    delete from public.outcomes x
     where x.organisation_id = new.id
       and (v_want is null or x.outcome_type <> v_want)
    returning x.id, x.outcome_type
  )
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  select
    v_actor,
    'outcome_deleted',
    'outcomes',
    gone.id,
    jsonb_build_object('organisation_id', new.id, 'outcome_type', gone.outcome_type, 'trigger', 'outcome_mirror')
    from gone;

  if v_want is not null then
    insert into public.outcomes
      (organisation_id, outreach_message_id, outcome_type, recorded_by_user_id)
    values (
      new.id,
      (
        select om.id
          from public.outreach_messages om
         where om.organisation_id = new.id
           and om.sent_at is not null
         order by om.sent_at desc
         limit 1
      ),
      v_want,
      v_actor
    )
    on conflict (organisation_id, outcome_type) do nothing;
  end if;

  return null;
end;
$$;

comment on function public.organisations_outcome_mirror() is
  'Keeps OUTCOMES equal to each client''s terminal pipeline status whatever wrote '
  'the status. Fired at commit by organisations_outcome_mirror_on_insert/_on_update. '
  'Idempotent: a no-op when set_outreach_status, set_outreach_status_bulk or '
  'advance_outreach_pipeline_on_send already maintained the row.';

revoke execute on function public.organisations_outcome_mirror() from public, anon, authenticated;

drop trigger if exists organisations_outcome_mirror_on_insert on public.organisations;
create constraint trigger organisations_outcome_mirror_on_insert
  after insert on public.organisations
  deferrable initially deferred
  for each row
  when (new.outreach_status::text in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no'))
  execute function public.organisations_outcome_mirror();

drop trigger if exists organisations_outcome_mirror_on_update on public.organisations;
create constraint trigger organisations_outcome_mirror_on_update
  after update of outreach_status on public.organisations
  deferrable initially deferred
  for each row
  when (old.outreach_status is distinct from new.outreach_status)
  execute function public.organisations_outcome_mirror();

-- ---------------------------------------------------------------------------
-- One-time reconcile of rows written before the triggers existed
-- ---------------------------------------------------------------------------

with gone as (
  delete from public.outcomes x
   using public.organisations o
   where o.id = x.organisation_id
     and x.outcome_type::text is distinct from (case
           when o.outreach_status = 'responded' then 'reply'
           when o.outreach_status::text in ('converted', 'no_response', 'soft_no', 'hard_no') then o.outreach_status::text
         end)
  returning x.id, x.organisation_id, x.outcome_type
)
insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
select
  null,
  'outcome_deleted',
  'outcomes',
  gone.id,
  jsonb_build_object('organisation_id', gone.organisation_id, 'outcome_type', gone.outcome_type, 'trigger', 'outcome_mirror_backfill')
  from gone;

insert into public.outcomes
  (organisation_id, outreach_message_id, outcome_type, recorded_by_user_id, created_at)
select
  o.id,
  (
    select om.id
      from public.outreach_messages om
     where om.organisation_id = o.id
       and om.sent_at is not null
     order by om.sent_at desc
     limit 1
  ),
  (case when o.outreach_status = 'responded' then 'reply' else o.outreach_status::text end)::public.outcome_type,
  null,
  -- Dated from when the client actually reached this status, so the
  -- Performance section's windows count it in the right week.
  coalesce(
    (
      select max(a.created_at)
        from public.audit_log a
       where a.target_table = 'organisations'
         and a.action = 'status_changed'
         and a.target_id = o.id
         and a.detail ->> 'to' = o.outreach_status::text
    ),
    o.updated_at
  )
  from public.organisations o
 where o.outreach_status::text in ('converted', 'responded', 'no_response', 'soft_no', 'hard_no')
on conflict (organisation_id, outcome_type) do nothing;
