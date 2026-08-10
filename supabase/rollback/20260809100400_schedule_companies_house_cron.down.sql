-- Rollback for: 20260809100400_schedule_companies_house_cron.sql
-- Apply manually against the target DB to reverse the paired migration.
-- Roll this back BEFORE 20260809100000_enable_cron_extensions.down.sql — that one
-- drops pg_cron itself, which would take these jobs down anyway but leave nothing
-- for this file's cron.unschedule to act on.

select cron.unschedule('companies_house_discovery_weekly');
select cron.unschedule('companies_house_status_recheck_weekly');
