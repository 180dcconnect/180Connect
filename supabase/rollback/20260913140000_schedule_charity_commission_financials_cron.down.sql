-- Rollback for: 20260913140000_schedule_charity_commission_financials_cron.sql
-- Apply manually against the target DB to reverse the paired migration.

select cron.unschedule('charity_commission_financial_refresh_weekly');
