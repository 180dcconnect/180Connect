-- Rollback for: 20260723100100_create_user_role_rpc.sql
-- Story: F012 / F224 (#219)
-- Apply manually against the target DB to reverse the paired migration.
-- After this, no one can change a user role until another write-path exists.

drop function if exists public.set_user_role(uuid, public.user_role);
