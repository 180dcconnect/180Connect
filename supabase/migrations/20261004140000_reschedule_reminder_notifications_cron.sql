-- Migration: reschedule_reminder_notifications_cron
-- Story: notification digest emails (Daily / Weekly digest, F178).
--
-- WHAT THIS CHANGES:
--   reminder_notifications_daily moves from 04:22 UTC once a day to 08:00 and
--   09:00 UTC. The job's command is unchanged — cron.schedule with an existing
--   job name updates that job in place.
--
-- WHY: the route this job calls now also sends the daily and weekly digest
--   emails, and the team is students — a digest at 05:22 sits under a night's
--   worth of other mail. Digests go out at 9am UK time.
--
-- WHY TWO RUNS: pg_cron schedules in UTC, and 9am in the UK is 08:00 UTC in
--   summer (BST) and 09:00 UTC in winter (GMT). The job runs at both; the
--   digest sweep only sends on the run where it is 9am in London
--   (isDigestDue in src/lib/notification-digest.ts), so exactly one run a day
--   sends digests whatever the clocks are doing. The follow-up reminder sweep
--   in the same route runs on both, which is safe: it records every reminder it
--   sends (audit_log reminder_notification_sent) and never repeats one for the
--   same episode, so the second run finds nothing new.
--
-- Schema change approval record (SOP §7):
--   Change        | Re-schedule the existing reminder_notifications_daily
--                 | pg_cron job to '0 8,9 * * *'.
--   Reason        | Digest emails at 9am UK time, year-round.
--   Compatibility | Same job name, same command. No table, grant or column
--                 | changes. Follow-up reminders now arrive at 9am rather than
--                 | before dawn.
--   Data migration| None.
--   Security      | Unchanged: CRON_SECRET-gated route, same vault secrets.
--   Documentation | Route and digest module headers.
--
-- Reversibility: paired rollback in
-- ../rollback/20261004140000_reschedule_reminder_notifications_cron.down.sql

select cron.schedule(
  'reminder_notifications_daily',
  '0 8,9 * * *', -- 08:00 and 09:00 UTC; digests send on whichever is 9am in London
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/reminder-notifications?x-vercel-protection-bypass='
      || (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
