-- Migration: team_tasks_tracker
-- Adds a compact stored priority to ACTIONS and audited admin write paths for
-- editing, reassignment and reversible status changes from Team tasks.
--
-- Compatibility: additive column with a default, so old readers and writers
-- continue to work while the UI rolls forward. Existing rows become Normal.
-- Storage: one SMALLINT per row plus one narrow index; no new table or file
-- bytes, keeping the Supabase free-plan database constraint in view.
-- Security: existing RLS remains enabled. SECURITY DEFINER functions re-check
-- active-admin access, lock the row, reject stale edits, and write ownership or
-- status changes to AUDIT_LOG in the same transaction.
-- Reversibility: paired rollback in
-- ../rollback/20261017040000_team_tasks_tracker.down.sql

alter table public.actions
  add column priority smallint not null default 2,
  add constraint actions_priority_valid check (priority between 1 and 3);

comment on column public.actions.priority is
  'Task priority: 1 High, 2 Normal, 3 Low. The UI translates these internal values into plain-English choices.';

create index actions_status_due_priority_idx
  on public.actions (status, due_date, priority, created_at);

create or replace function public.update_team_task(
  p_action_id uuid,
  p_title text,
  p_description text,
  p_due_date date,
  p_priority smallint,
  p_assignee_user_id uuid,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action public.actions%rowtype;
  v_updated_at timestamptz;
  v_details_changed boolean;
begin
  if not app.is_active_user() or not app.is_admin() then
    raise exception 'only an administrator can edit team tasks' using errcode = '42501';
  end if;

  if p_title is null or length(trim(p_title)) = 0 or length(trim(p_title)) > 200 then
    raise exception 'task title is invalid' using errcode = '23514';
  end if;
  if p_description is not null and length(trim(p_description)) > 2000 then
    raise exception 'task description is too long' using errcode = '23514';
  end if;
  if p_priority is null or p_priority not between 1 and 3 then
    raise exception 'task priority is invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from public.users
     where id = p_assignee_user_id
       and is_active = true
       and role in ('cam', 'admin')
       and deleted_at is null
  ) then
    raise exception 'assignee is not an active team member' using errcode = '23503';
  end if;

  select * into v_action
    from public.actions
   where id = p_action_id
   for update;

  if v_action.id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_action.updated_at is distinct from p_expected_updated_at then
    raise exception 'task changed since it was opened' using errcode = '40001';
  end if;

  v_details_changed :=
    v_action.title is distinct from trim(p_title)
    or v_action.description is distinct from nullif(trim(p_description), '')
    or v_action.due_date is distinct from p_due_date
    or v_action.priority is distinct from p_priority;

  if not v_details_changed
     and v_action.assignee_user_id is not distinct from p_assignee_user_id then
    return v_action.updated_at;
  end if;

  update public.actions
     set title = trim(p_title),
         description = nullif(trim(p_description), ''),
         due_date = p_due_date,
         priority = p_priority,
         assignee_user_id = p_assignee_user_id
   where id = p_action_id
  returning updated_at into v_updated_at;

  if v_action.assignee_user_id is distinct from p_assignee_user_id then
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      v_actor,
      'action_reassigned',
      'actions',
      p_action_id,
      jsonb_build_object(
        'organisation_id', v_action.organisation_id,
        'title', trim(p_title),
        'from_user_id', v_action.assignee_user_id,
        'to_user_id', p_assignee_user_id
      )
    );
  end if;

  if v_details_changed then
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      v_actor,
      'action_updated',
      'actions',
      p_action_id,
      jsonb_build_object(
        'organisation_id', v_action.organisation_id,
        'title', trim(p_title),
        'changed_fields', array_remove(array[
          case when v_action.title is distinct from trim(p_title) then 'title' end,
          case when v_action.description is distinct from nullif(trim(p_description), '') then 'description' end,
          case when v_action.due_date is distinct from p_due_date then 'due_date' end,
          case when v_action.priority is distinct from p_priority then 'priority' end
        ], null)
      )
    );
  end if;

  return v_updated_at;
end;
$$;

create or replace function public.set_team_task_status(
  p_action_id uuid,
  p_status public.action_status,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action public.actions%rowtype;
  v_updated_at timestamptz;
  v_audit_action text;
begin
  if not app.is_active_user() or not app.is_admin() then
    raise exception 'only an administrator can change team task status' using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'task status is invalid' using errcode = '23514';
  end if;

  select * into v_action
    from public.actions
   where id = p_action_id
   for update;

  if v_action.id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_action.updated_at is distinct from p_expected_updated_at then
    raise exception 'task changed since it was opened' using errcode = '40001';
  end if;
  if v_action.status = p_status then
    return v_action.updated_at;
  end if;

  update public.actions
     set status = p_status,
         completed_at = case when p_status = 'completed' then now() else null end,
         completed_by_user_id = case when p_status = 'completed' then v_actor else null end
   where id = p_action_id
  returning updated_at into v_updated_at;

  v_audit_action := case p_status
    when 'completed' then 'action_completed'
    when 'cancelled' then 'action_cancelled'
    else 'action_reopened'
  end;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    v_audit_action,
    'actions',
    p_action_id,
    jsonb_build_object(
      'organisation_id', v_action.organisation_id,
      'title', v_action.title,
      'from_status', v_action.status,
      'to_status', p_status,
      'assignee_user_id', v_action.assignee_user_id
    )
  );

  return v_updated_at;
end;
$$;

comment on function public.update_team_task(uuid, text, text, date, smallint, uuid, timestamptz) is
  'Admin-only Team tasks edit. Checks active assignee, rejects stale edits, and audits detail or assignee changes.';
comment on function public.set_team_task_status(uuid, public.action_status, timestamptz) is
  'Admin-only reversible Team tasks status transition with completion metadata and an audit row in the same transaction.';

revoke execute on function public.update_team_task(uuid, text, text, date, smallint, uuid, timestamptz) from public, anon;
revoke execute on function public.set_team_task_status(uuid, public.action_status, timestamptz) from public, anon;
grant execute on function public.update_team_task(uuid, text, text, date, smallint, uuid, timestamptz) to authenticated;
grant execute on function public.set_team_task_status(uuid, public.action_status, timestamptz) to authenticated;
