-- Rollback for: 20260809100300_create_resolve_data_quality_event_rpc.sql
-- Apply manually against the target DB to reverse the paired migration.

drop function if exists public.resolve_data_quality_event(uuid, text);
