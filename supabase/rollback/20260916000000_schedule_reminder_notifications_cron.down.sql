-- Rollback of 20260916000000_schedule_reminder_notifications_cron.sql.
-- Unschedule the F175 reminder-notification sweep. No other changes to reverse.

select cron.unschedule('reminder_notifications_daily');
