-- Rollback for 20260801100000_create_actions.sql
--
-- Drops the F168/F257 actions table and its status enum. This discards every action
-- row: there is nowhere else in the schema that per-user work is recorded, so the data
-- is not recoverable from another table afterwards. Do not run this against an
-- environment where CAMs have started using the actions tab without exporting first.
--
-- The trigger and policies go with the table, but are dropped explicitly so that a
-- partial failure cannot leave a policy naming a table that is on its way out.
-- The enum is dropped last: public.actions.status depends on it.

drop policy if exists actions_delete_own_open on public.actions;
drop policy if exists actions_delete_admin on public.actions;
drop policy if exists actions_update_assignee on public.actions;
drop policy if exists actions_update_admin on public.actions;
drop policy if exists actions_insert_cam on public.actions;
drop policy if exists actions_insert_admin on public.actions;
drop policy if exists actions_select_active on public.actions;

drop trigger if exists actions_set_updated_at on public.actions;

drop table if exists public.actions;

drop type if exists public.action_status;
