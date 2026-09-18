-- Rollback of 20260902120100_schedule_scheduled_outreach_cron.sql.
-- Unschedule the F126 delivery job. No other changes to reverse.

select cron.unschedule('scheduled_outreach_delivery');
