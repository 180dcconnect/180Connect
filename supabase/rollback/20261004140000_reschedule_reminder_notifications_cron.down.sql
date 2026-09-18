-- Rollback for 20261004140000_reschedule_reminder_notifications_cron.sql.
--
-- Puts reminder_notifications_daily back on its original 04:22 UTC schedule
-- (20260916000000). No data affected. Note: with the digest sweep's 9am-London
-- gate still in the code, a 04:22 run never sends digests — roll the code back
-- too, or digests stop.

select cron.schedule(
  'reminder_notifications_daily',
  '22 4 * * *',
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
