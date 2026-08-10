-- Migration: schedule_companies_house_cron
-- Story: F032/F260 follow-on — automated Companies House discovery + status watch.
-- Purpose: schedule the two weekly jobs via pg_cron + pg_net, calling the
--   CRON_SECRET-protected route handlers (src/app/api/cron/companies-house-import,
--   src/app/api/cron/companies-house-status-recheck) that do the actual work. This
--   is the first real consumer of CRON_SECRET (src/lib/env.ts) — declared since
--   before this feature but explicitly documented as unconsumed (docs/open-questions.md
--   Q-02), which already proposed exactly this pg_cron + secret-checked-route-handler
--   shape for a different (not-yet-built) feature. This migration sets the actual
--   convention rather than inventing a new one.
--
-- Offset one run apart (Monday vs Thursday) so the two jobs never call the
-- Companies House API back-to-back — each already makes several requests of its own
-- (three tier queries for discovery, up to STATUS_RECHECK_BATCH_SIZE profile fetches
-- for the recheck).
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT (run once against each of
-- 180connect-staging and 180connect-production — different app URLs, same as every
-- other per-environment secret in this project):
--
--   select vault.create_secret('https://<this-environment-app-url>', 'companies_house_cron_base_url');
--   select vault.create_secret('<the same value as the Vercel CRON_SECRET env var>', 'cron_secret');
--
-- The migration itself only references these secrets by name — never hardcodes a
-- URL or the secret value — because migrations run identically against both
-- projects and staging/production have different app URLs.
--
-- Schema change approval record (SOP §7):
--   Change        | Two cron.schedule(...) jobs calling net.http_post against the
--                 | new cron route handlers.
--   Reason        | Weekly automated discovery + status watch (this feature's core
--                 | requirement) needs something to actually invoke the routes on a
--                 | schedule — the manual "Import" button alone only covers the
--                 | zero-input-click half of the requirement, not the "keeps
--                 | discovering new registrations automatically" half.
--   Compatibility | New scheduled jobs only. No table changes. Depends on
--                 | 20260809100000_enable_cron_extensions.sql (pg_cron, pg_net) and
--                 | the vault secrets above already existing.
--   Data migration| None.
--   Security      | The route handlers themselves check CRON_SECRET before doing any
--                 | work (401 otherwise) — see src/app/api/cron/*/route.ts. The vault
--                 | secret is readable only by database roles with vault access
--                 | (superuser-equivalent), not by anon/authenticated.
--   Documentation | Approved by Bashir (Project Leader), 9 Aug 2026.
--
-- Reversibility: paired rollback in
-- ../rollback/20260809100400_schedule_companies_house_cron.down.sql

select cron.schedule(
  'companies_house_discovery_weekly',
  '0 2 * * 1', -- Monday 02:00 UTC
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
  '0 2 * * 4', -- Thursday 02:00 UTC
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
