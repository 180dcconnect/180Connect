-- Rollback for: 20260811090300_add_ingestion_runs_records_flagged.sql
-- Apply manually against the target DB to reverse the paired migration.

alter table public.ingestion_runs
  drop column if exists records_flagged;
