-- Rollback for 20261017030000_cron_prune_keeps_last_run.sql
--
-- Restores the prune command as 20261003150000 scheduled it: a flat one-day
-- retention that keeps no row a job's cadence outruns. Reverting means System
-- health goes back to reporting a weekly job as "Waiting for its first run" on
-- six days in seven.

select cron.unschedule('cron_run_log_prune_daily')
where exists (
  select 1 from cron.job where jobname = 'cron_run_log_prune_daily'
);

select cron.schedule(
  'cron_run_log_prune_daily',
  '52 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '1 day' $$
);
