-- Rollback: replace_deactivation_with_delete
--
-- Reverses the schema only. A redaction is irreversible by design: accounts that
-- delete_user redacted stay redacted, and accounts it hard-deleted stay deleted.
-- deactivate_user is not recreated — re-apply its definition from
-- 20260804170000_unify_offboarding_reassignment.sql, and set_user_active /
-- set_user_role from 20260804153000_last_admin_guard.sql, if the old model is wanted
-- back in full.

drop function if exists public.delete_user(uuid, text, uuid, boolean);
drop function if exists public.suspend_user(uuid, text, uuid, boolean);
drop function if exists app.transfer_user_work(uuid, text, uuid, boolean);

alter table public.users
  drop constraint if exists users_deleted_at_implies_inactive;

alter table public.users
  add column if not exists deactivated_at timestamptz;

alter table public.users
  add constraint users_deactivated_at_matches_inactive
  check (deactivated_at is null or is_active = false);

-- Redacted accounts become deactivated ones: the nearest state the old model has.
update public.users
   set deactivated_at = deleted_at
 where deleted_at is not null;

alter table public.users
  drop column if exists deleted_at;
