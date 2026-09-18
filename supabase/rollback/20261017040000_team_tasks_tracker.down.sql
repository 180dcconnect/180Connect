drop function if exists public.set_team_task_status(uuid, public.action_status, timestamptz);
drop function if exists public.update_team_task(uuid, text, text, date, smallint, uuid, timestamptz);
drop index if exists public.actions_status_due_priority_idx;
alter table public.actions drop constraint if exists actions_priority_valid;
alter table public.actions drop column if exists priority;
