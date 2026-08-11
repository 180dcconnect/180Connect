-- Rollback for: 20260809100100_add_companies_house_status_check_cursor.sql
-- Apply manually against the target DB to reverse the paired migration.

drop index if exists public.raw_source_records_status_check_idx;
alter table public.raw_source_records drop column if exists status_last_checked_at;
