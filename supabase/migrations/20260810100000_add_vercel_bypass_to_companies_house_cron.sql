-- Migration: add_vercel_bypass_to_companies_house_cron
-- Story: F032/F260 follow-on — automated Companies House discovery + status watch.
-- Purpose: fix-forward correction of 20260809100400_schedule_companies_house_cron.sql
--   (fix-forward per SOP §7 / MIGRATIONS.md — that migration is already applied and
--   is never hand-edited).
--
-- WHAT WAS WRONG: this project's Vercel deployment has SSO/Vercel-Authentication
-- protection enabled for every deployment on a non-custom domain
-- (`ssoProtection.deploymentType = "all_except_custom_domains"`, confirmed live via
-- the Vercel API, 10 Aug 2026). The dev-branch alias the cron jobs call
-- (companies_house_cron_base_url — 180connect-git-dev-180connect.vercel.app) is a
-- *.vercel.app domain, not a custom domain, so it IS protected: an unauthenticated
-- net.http_post from pg_cron would be intercepted by Vercel's auth wall before ever
-- reaching the route handler's own CRON_SECRET check. The two jobs as originally
-- scheduled would silently no-op every week.
--
-- THE FIX: Vercel's documented mechanism for exactly this case is "Protection Bypass
-- for Automation" — a project-level secret appended as a query param
-- (?x-vercel-protection-bypass=<secret>) that Vercel's edge recognises and lets
-- through before the deployment-protection check, independent of CRON_SECRET (which
-- still runs afterwards, inside the route handler, as the real authorisation check).
-- Generated once via the Vercel API (PATCH /v1/projects/{id}/protection-bypass),
-- stored here as a second vault secret, 'vercel_protection_bypass' (10 Aug 2026).
--
-- cron.schedule upserts by job name (Supabase's documented pg_cron wrapper
-- behaviour), so re-running it with the corrected body replaces the two jobs
-- in place rather than creating duplicates.
--
-- Schema change approval record (SOP §7):
--   Change        | Re-schedule companies_house_discovery_weekly and
--                 | companies_house_status_recheck_weekly with the Vercel
--                 | protection-bypass query param added to their net.http_post URL.
--   Reason        | The original schedule (20260809100400) would have been silently
--                 | blocked by Vercel deployment protection — see above.
--   Compatibility | Same two job names, same cadence. No table changes.
--   Data migration| None.
--   Security      | The bypass secret only grants past Vercel's edge auth wall to
--                 | the app itself — the route handler's own CRON_SECRET check
--                 | (src/app/api/cron/*/route.ts) is unchanged and still the real
--                 | authorisation gate. Both secrets live in Supabase Vault, not in
--                 | this file.
--   Documentation | Approved by Bashir (Project Leader), 10 Aug 2026.
--
-- Reversibility: paired rollback in
-- ../rollback/20260810100000_add_vercel_bypass_to_companies_house_cron.down.sql

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

select cron.schedule(
  'companies_house_status_recheck_weekly',
  '0 2 * * 4', -- Thursday 02:00 UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/companies-house-status-recheck?x-vercel-protection-bypass='
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
