-- Rollback for: 20260923132000_retire_companies_house_discovery_cron.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Reschedules the weekly Companies House discovery job. Note this only
-- restores the *schedule*: the route it calls
-- (src/app/api/cron/companies-house-import/route.ts) and the adapter behind
-- it are deleted in the same commit as the migration, so the code has to come
-- back too or every run will 404.

select cron.schedule(
  'companies_house_discovery_weekly',
  '0 2 * * 1', -- Monday 02:00 UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/companies-house-import?x-vercel-protection-bypass='
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
