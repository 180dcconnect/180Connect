-- Migration: schedule_charity_commission_cron
-- Story: F049 — Weekly Data Refresh Job (Charity Commission half).
-- Purpose: schedule the two weekly Charity Commission jobs via pg_cron + pg_net,
--   calling the CRON_SECRET-protected route handlers
--   (src/app/api/cron/charity-commission-import,
--   src/app/api/cron/charity-commission-status-recheck) that do the actual work.
--   Same convention as the existing Companies House jobs
--   (20260809100400_schedule_companies_house_cron.sql,
--   20260810100000_add_vercel_bypass_to_companies_house_cron.sql), including the
--   Vercel deployment-protection bypass query param from the outset (learned the
--   hard way for Companies House; no reason to repeat that outage here) and reuse
--   of the same three vault secrets — companies_house_cron_base_url really just
--   holds the app's base URL (not anything Companies-House-specific despite its
--   name; kept as-is per MIGRATIONS.md's no-rename-without-Wednesday-call rule
--   rather than duplicating an identical secret under a new name), cron_secret, and
--   vercel_protection_bypass.
--
-- Tuesday/Friday, not Monday/Thursday: offset from the existing Companies House
-- jobs so the two sources' weekly jobs never call their (different) upstream APIs
-- back-to-back on the same schedule, and so a shared CRON_SECRET-protected route
-- outage window doesn't take out both sources' automation for the same run.
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: none beyond what
-- 20260809100400_schedule_companies_house_cron.sql already required — this reuses
-- the same three vault secrets, already created per environment.
--
-- Schema change approval record (SOP §7):
--   Change        | Two cron.schedule(...) jobs calling net.http_post against the
--                 | new Charity Commission cron route handlers.
--   Reason        | Weekly automated discovery + status watch for Charity
--                 | Commission (F049's core requirement, previously only built for
--                 | Companies House).
--   Compatibility | New scheduled jobs only. No table changes. Depends on
--                 | 20260809100000_enable_cron_extensions.sql (pg_cron, pg_net) and
--                 | the existing vault secrets already existing.
--   Data migration| None.
--   Security      | The route handlers themselves check CRON_SECRET before doing any
--                 | work (401 otherwise) — see src/app/api/cron/charity-commission-*/
--                 | route.ts. The vault secret is readable only by database roles
--                 | with vault access (superuser-equivalent), not by anon/authenticated.
--   Documentation | Reviewed by Bashir (Project Leader) as part of the F049 PR.
--
-- Reversibility: paired rollback in
-- ../rollback/20260811090200_schedule_charity_commission_cron.down.sql

select cron.schedule(
  'charity_commission_discovery_weekly',
  '0 2 * * 2', -- Tuesday 02:00 UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/charity-commission-import?x-vercel-protection-bypass='
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

select cron.schedule(
  'charity_commission_status_recheck_weekly',
  '0 2 * * 5', -- Friday 02:00 UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/charity-commission-status-recheck?x-vercel-protection-bypass='
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
