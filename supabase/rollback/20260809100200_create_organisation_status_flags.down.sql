-- Rollback for: 20260809100200_create_organisation_status_flags.sql
-- Apply manually against the target DB to reverse the paired migration.

drop function if exists public.acknowledge_organisation_status_flag(uuid, text);
drop function if exists public.record_organisation_status_flag(uuid, text, text, text);
drop table if exists public.organisation_status_flags;
