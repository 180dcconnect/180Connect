-- Rollback for: 20260811090100_add_charity_commission_status_check_index.sql
-- Apply manually against the target DB to reverse the paired migration.

drop index if exists public.raw_source_records_charity_commission_status_check_idx;
