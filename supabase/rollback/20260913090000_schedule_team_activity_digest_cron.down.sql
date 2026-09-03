-- Rollback of 20260913090000_schedule_team_activity_digest_cron.sql.
-- Unschedule the F176 team-activity digest sweep. No other changes to reverse.

select cron.unschedule('team_activity_digest_hourly');
