-- Rollback for: 20260810100000_add_vercel_bypass_to_companies_house_cron.sql
-- Apply manually against the target DB to reverse the paired migration — restores
-- the two jobs to the (broken, pre-bypass) bodies from
-- 20260809100400_schedule_companies_house_cron.sql. Only useful if that migration
-- is still applied too; if both are being rolled back, use that file's own
-- rollback instead, which unschedules the jobs entirely.

select cron.schedule(
  'companies_house_discovery_weekly',
  '0 2 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/companies-house-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'companies_house_status_recheck_weekly',
  '0 2 * * 4',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/companies-house-status-recheck',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
