-- Migration: schedule_gmail_watch_renewal
-- Story: reply sync in seconds — Gmail push notifications.
-- Sequence: addition. Not a numbered step — cron jobs are not rows in Data Model
--   tab 11, following 20260912160100_schedule_gmail_reply_sync.
--
-- Replies used to reach the inbox only when gmail_reply_sync polled (every five
-- minutes). Gmail can instead publish to Cloud Pub/Sub the moment the branch
-- inbox changes; a push subscription then calls /api/webhooks/gmail, which runs
-- the same capture over the last few minutes (src/lib/gmail/push.ts). That
-- needs a live `users.watch` on the mailbox, and Gmail expires a watch after
-- 7 days — this job renews it.
--
-- Twice a day, not weekly: a renewal extends a live watch, so running often
-- costs one Gmail call and buys days of margin against failed runs. 03:47 and
-- 15:47 UTC sit clear of the 03:30/03:40 prunes, the 04:xx daily jobs, the :05
-- digest and the five-minute jobs' minutes (0,5,… and 1,6,…).
--
-- gmail_reply_sync is deliberately unchanged at five minutes: it is now the
-- safety net for any notification Pub/Sub drops or delivers late.
--
-- No table, column or policy change. Reuses the existing vault secrets
-- (companies_house_cron_base_url, vercel_protection_bypass, cron_secret).
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: the Pub/Sub topic, subscription and
-- GMAIL_PUBSUB_TOPIC / GMAIL_PUSH_AUDIENCE / GMAIL_PUSH_SERVICE_ACCOUNT env vars
-- in docs/gmail-push-setup.md. Until they exist this job's route answers 503
-- and reports the missing config; nothing else is affected.
--
-- Reversibility: ../rollback/20261003140000_schedule_gmail_watch_renewal.down.sql

select cron.schedule(
  'gmail_watch_renew',
  '47 3,15 * * *', -- 03:47 and 15:47 UTC; Gmail expires a watch after 7 days
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/gmail-watch?x-vercel-protection-bypass='
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
