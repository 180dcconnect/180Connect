-- Rollback for: 20260811090200_schedule_charity_commission_cron.sql
-- Apply manually against the target DB to reverse the paired migration.

select cron.unschedule('charity_commission_discovery_weekly');
select cron.unschedule('charity_commission_status_recheck_weekly');
