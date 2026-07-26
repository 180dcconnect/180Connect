-- Rollback for: 20260723100000_create_audit_log.sql
-- F224 (#219) / F221
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING: destroys the entire audit trail. On staging or production that is the
-- record of who changed what — by definition not reconstructable. Take a backup
-- first (SOP §8). Roll back create_user_role_rpc first: set_user_role writes here.

drop table if exists public.audit_log;
