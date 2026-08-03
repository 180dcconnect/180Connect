-- Rollback for: 20260729232004_create_user_active_rpc.sql
-- Story: F013 (#15)
-- Apply manually against the target DB to reverse the paired migration.
-- After this, no one can suspend or reactivate a user until another write-path
-- exists: users.is_active is granted to nobody, so this function is the only one.
-- Already-suspended users stay suspended and cannot be restored through the app.

drop function if exists public.set_user_active(uuid, boolean);
