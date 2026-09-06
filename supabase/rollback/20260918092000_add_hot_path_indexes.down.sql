-- Rollback for: 20260918092000_add_hot_path_indexes.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Drops both indexes. No data is touched and no access changes; the queries that
-- used them go back to sequential scans and an in-memory sort. Safe to run at
-- any time.

drop index if exists public.organisations_legal_name_id_idx;
drop index if exists public.raw_source_records_matched_org_idx;
