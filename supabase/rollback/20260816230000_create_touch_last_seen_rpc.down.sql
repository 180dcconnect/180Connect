-- Rollback for: 20260816230000_create_touch_last_seen_rpc.sql
-- Apply manually against the target DB to reverse the paired migration.
-- After this, last_seen_at is never written and stops updating.

drop function if exists public.touch_last_seen();
