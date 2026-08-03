-- Rollback for 20260802100000_create_reassign_ownership_rpc.sql
--
-- Drops the F257 reassignment RPCs. The audit_log rows they wrote are left in place —
-- audit_log is append-only by design, and the record of a handover that really happened
-- should outlive the function that performed it.
--
-- After this runs there is no write path to actions.assignee_user_id for any end-user
-- role (the column carries no UPDATE grant), so ownership can still move via the
-- organisations policies but the open actions will not follow it. That is the intended
-- state of the world before this migration, not a bug — but do not leave it there.

drop function if exists public.reassign_actions(uuid[], uuid, text);
drop function if exists public.reassign_ownership(uuid[], uuid, text, uuid);
