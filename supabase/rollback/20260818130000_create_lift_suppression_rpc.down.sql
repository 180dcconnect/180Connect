-- Rollback for 20260818130000_create_lift_suppression_rpc.sql

drop function if exists public.lift_suppression(uuid, text);

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
