-- F131: poll Gmail every five minutes, matching the scheduler's existing latency
-- convention. Reuses the approved cron base URL, protection bypass, and CRON_SECRET
-- vault entries documented by 20260902120100_schedule_scheduled_outreach_cron.sql.
-- No table/schema-model change; this is a new scheduled integration trigger only.
-- Reversibility: ../rollback/20260911110000_schedule_gmail_reply_sync.down.sql

select cron.schedule(
  'gmail_reply_sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/gmail-replies?x-vercel-protection-bypass='
      || (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
