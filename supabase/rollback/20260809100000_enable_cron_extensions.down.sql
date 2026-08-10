-- Rollback for: 20260809100000_enable_cron_extensions.sql
-- Apply manually against the target DB to reverse the paired migration.
-- WARNING: only safe once schedule_companies_house_cron's rollback has already
-- unscheduled its jobs (roll back in reverse order) — dropping pg_cron drops
-- every cron.job row project-wide, not just this feature's.

drop extension if exists pg_net;
drop extension if exists pg_cron;
