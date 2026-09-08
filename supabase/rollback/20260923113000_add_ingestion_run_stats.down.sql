-- Rollback for: 20260922103000_add_ingestion_run_stats.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Destructive: drops the recorded funnels. They are not recoverable from
-- anything else we store — re-running the bulk import recomputes a funnel for
-- the new run only, not for the historical ones this drops.

alter table public.ingestion_runs
  drop column if exists run_stats;
