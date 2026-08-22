-- Migration: create_lift_suppression_rpc
-- Sequence step 21.2 (addition to the Data Model migration sequence, appended after
--   step 21.1 create_suppressions rather than renumbered).
-- Story: F185 Remove Suppression (#181)
-- Spec: docs/rls-permission-matrix.md §3.14
--
-- SCOPE: F185 acceptance criteria:
--   1. An admin can view the list of suppressed or hidden charities and select one to unsuppress.
--   2. Removing suppression makes the charity visible again in the standard client list (F051)
--      and available for outreach, reversing the effect of F251/F248.
--   3. Unsuppressing a client is logged — who did it, when, and which client — consistent with
--      the audit requirement, since suppression exists for legal or reputation reasons and its
--      removal should be traceable.
--   4. Reason is mandatory for lifting a suppression (PRD §8.4 / §4.2).
--
-- WHO CAN UNSUPPRESS: Only an admin (app.is_admin()).
--
-- Schema change approval record (SOP §7):
--   Change        | Add public.lift_suppression(uuid, text) RPC; update
--                 | public.get_recent_team_activity to include suppression_lifted.
--   Reason        | F185: Admins unsuppress hidden charities with required reason (#181).
--   Compatibility | Additive RPC; uses existing 'lifted' value of public.suppression_status.
--   Data migration| None.
--   Security      | SECURITY DEFINER; self-checks app.is_admin(); requires non-empty reason;
--                 | writes audit_log in the same transaction.
--   Documentation | Data Model tab 04 (entities) + tab 02 (data dictionary) + rls matrix §3.14.
--
-- Reversibility: paired rollback in ../rollback/20260818130000_create_lift_suppression_rpc.down.sql

create or replace function public.lift_suppression(
  p_suppression_id uuid,
  p_reason         text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_org_id     uuid;
  v_status     public.suppression_status;
begin
  if not app.is_admin() then
    raise exception 'only an admin may lift a suppression'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to lift a suppression'
      using errcode = '23514';
  end if;

  select organisation_id, status into v_org_id, v_status
    from public.suppressions
   where id = p_suppression_id;

  if v_org_id is null then
    raise exception 'suppression % not found', p_suppression_id
      using errcode = 'P0002';
  end if;

  if v_status <> 'active' then
    raise exception 'suppression % is not active', p_suppression_id
      using errcode = '55000';
  end if;

  update public.suppressions
     set status = 'lifted',
         decided_by = v_actor,
         decided_at = now(),
         decision_note = p_reason
   where id = p_suppression_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'suppression_lifted',
    'organisations', v_org_id,
    jsonb_build_object('suppression_id', p_suppression_id, 'reason', p_reason)
  );
end;
$$;

comment on function public.lift_suppression(uuid, text) is
  'F185: admin lifts an active suppression with a mandatory written reason. Sets '
  'status to lifted, unblocking outreach and restoring visibility. SECURITY DEFINER; '
  'self-checks app.is_admin(), verifies active status and non-blank reason, writes '
  'audit_log in the same transaction.';

revoke execute on function public.lift_suppression(uuid, text) from public;
revoke execute on function public.lift_suppression(uuid, text) from anon;
grant execute on function public.lift_suppression(uuid, text) to authenticated;

-- Update public.get_recent_team_activity to include suppression_lifted
create or replace function public.get_recent_team_activity(p_limit int default 10)
returns table (
  id uuid,
  actor_user_id uuid,
  actor_name text,
  action text,
  target_table text,
  target_id uuid,
  target_name text,
  detail jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'active account required' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.actor_user_id,
    coalesce(nullif(trim(u.full_name), ''), u.email, 'A team member')::text as actor_name,
    a.action,
    a.target_table,
    a.target_id,
    case
      when a.target_table = 'organisations' then org.legal_name
      else null
    end::text as target_name,
    a.detail,
    a.created_at
  from public.audit_log a
  left join public.users u on u.id = a.actor_user_id
  left join public.organisations org on org.id = a.target_id and a.target_table = 'organisations'
  where a.action in (
    'ownership_assigned',
    'ownership_reassigned',
    'status_changed',
    'suppression_requested',
    'suppression_approved',
    'suppression_lifted',
    'organisation_status_flagged',
    'organisation_status_flag_acknowledged',
    'data_quality_event_resolved',
    'duplicate_confirmed',
    'duplicate_dismissed',
    'invite_accepted'
  )
    and a.actor_user_id is not null
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

comment on function public.get_recent_team_activity(int) is
  'F029: safe team activity feed for CAM dashboard. Returns recent actions by team '
  'members with real names resolved; never exposes sensitive admin security logs.';

revoke execute on function public.get_recent_team_activity(int) from public;
revoke execute on function public.get_recent_team_activity(int) from anon;
grant execute on function public.get_recent_team_activity(int) to authenticated;
