-- Rollback for 20260924090100_schedule_inbox_thread_state_prune.sql
--
-- Unschedules the daily prune. Run this BEFORE the 20260924090000 rollback:
-- pg_cron keeps running a job whose function has been dropped, and logs a
-- failure every night until someone notices.
--
-- Guarded, so it is safe on an environment where the job was never created.

select cron.unschedule('inbox_thread_state_prune_daily')
where exists (
  select 1 from cron.job where jobname = 'inbox_thread_state_prune_daily'
);
