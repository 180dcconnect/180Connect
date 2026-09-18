-- Migration: cron_prune_keeps_last_run
-- Story: System health — "Financials refresh: waiting for its first run" on a
--   job that had just run.
-- Purpose: stop the daily cron-log prune from deleting a job's most recent run,
--   so a job slower than the retention window still reports a last run.
--
-- What went wrong: cron_run_log_prune_daily (20261003150000) keeps one day of
-- cron.job_run_details, sized for the 10- and 30-second jobs that add ~11,500
-- rows a day against the Free plan's 500 MB. The dashboard's System health card
-- reads each job's newest run from that table (get_outreach_cron_health, and
-- scheduledTaskRow in src/lib/dashboard/system-health.ts), and a job with no
-- run row at all reads as "Waiting for its first run".
--
-- charity_commission_financial_refresh_weekly runs Wednesdays at 03:00; the
-- prune runs at 03:52 daily. Its run row therefore survives about 24 hours out
-- of every 168, so for six days in seven the card called a working weekly job
-- one that had never run. Confirmed on staging: 0 rows in job_run_details for
-- that job, while FINANCIAL_PERIODS held a row written at 2026-09-16 03:00.
--
-- The fix is the cadence-independent one: keep the newest run per job forever,
-- prune the rest at a day as before. That is exactly what the card reads, it is
-- one row per job (~30 rows, a few KB), and the next job slower than daily
-- inherits the fix rather than repeating the bug.
--
-- Schema change approval record (SOP §7):
--   Change        | Re-schedule cron_run_log_prune_daily with a new command.
--                 | No table changes.
--   Reason        | The prune deleted the only evidence a weekly job runs, so
--                 | System health reported it as never having run.
--   Compatibility | Same job name, same 03:52 slot, same one-day retention for
--                 | every row but each job's latest. Depends on
--                 | 20261003150000_gmail_reply_check_and_cron_log_prune.sql.
--   Data migration| None. The retained set only grows by one row per job.
--   Security      | Unchanged: the job runs as it did before and touches only
--                 | cron.job_run_details.
--   Documentation | Reviewed by Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20261017030000_cron_prune_keeps_last_run.down.sql

-- Unschedule-first, as every cron migration here does: pg_cron's schedule()
-- does not dedupe by job name, and the conditional form avoids erroring on an
-- environment where the job is missing.
select cron.unschedule('cron_run_log_prune_daily')
where exists (
  select 1 from cron.job where jobname = 'cron_run_log_prune_daily'
);

select cron.schedule(
  'cron_run_log_prune_daily',
  '52 3 * * *', -- unchanged: 03:52 UTC, clear of the 03:30/03:40 prunes
  $$
  delete from cron.job_run_details rd
  where rd.end_time < now() - interval '1 day'
    and rd.runid is distinct from (
      select rd2.runid
      from cron.job_run_details rd2
      where rd2.jobid = rd.jobid
      order by rd2.end_time desc nulls last
      limit 1
    );
  $$
);
