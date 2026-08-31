-- Rollback for 20260913090000_create_complete_action_rpc.sql (F171, #173).
--
-- Restores the pre-migration grant, drops the RPC, then the column (and its
-- constraint, dropped automatically with the column).
--
-- Data loss on rollback: completed_by_user_id for every row that has it.
-- completed_at/status themselves are untouched — a completed action stays
-- completed, it just forgets who did it.

grant update (status, completed_at) on public.actions to authenticated;

drop function if exists public.complete_action(uuid);

alter table public.actions drop column if exists completed_by_user_id;
