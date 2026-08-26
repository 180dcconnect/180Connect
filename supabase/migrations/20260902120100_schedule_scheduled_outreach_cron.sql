-- Migration: schedule_scheduled_outreach_cron
-- Story: F126 (#122) — Schedule Reviewed Outreach Emails.
-- Purpose: schedule the five-minute scheduled-outreach delivery job via pg_cron +
--   pg_net, calling the CRON_SECRET-protected route handler
--   (src/app/api/cron/scheduled-outreach) that does the actual work.
--   Same convention as the Companies House and Charity Commission jobs
--   (20260809100400 / 20260810100000 / 20260811090200), including the Vercel
--   deployment-protection bypass query param and reuse of the same three vault
--   secrets — companies_house_cron_base_url really just holds the app's base URL
--   (not anything Companies-House-specific despite its name; kept as-is per
--   MIGRATIONS.md's no-rename-without-Wednesday-call rule).
--
-- Every five minutes, not weekly like the data-refresh jobs: this one delivers
-- emails a human explicitly queued for a chosen time, so its whole point is
-- latency — a CAM scheduling "10:00" expects it to land at 10:00-ish, not next
-- Tuesday. Five minutes keeps Gmail round-trips (up to 50 messages per run,
-- maxDuration 300s on the handler, same pg_net timeout as the other jobs)
-- comfortably inside each window while still firing 288 times/day against a
-- query that returns nothing almost always.
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: none beyond what
-- 20260809100400_schedule_companies_house_cron.sql already required — this reuses
-- the same three vault secrets, already created per environment.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job calling net.http_post against the
--                 | new scheduled-outreach cron route handler.
--   Reason        | F126 AC: an email queued for future delivery must actually be
--                 | delivered at that time — without a trigger the scheduler UI
--                 | queues emails nothing ever sends.
--   Compatibility | New scheduled job only. No table changes. Depends on
--                 | 20260809100000_enable_cron_extensions.sql (pg_cron, pg_net)
--                 | and the existing vault secrets already existing.
--   Data migration| None.
--   Security      | The route handler checks CRON_SECRET before doing any work
--                 | (401 otherwise) — see src/app/api/cron/scheduled-outreach/
--                 | route.ts. Delivery itself goes through the same audited,
--                 | suppression-rechecked path as F123's manual send; the vault
--                 | secret is readable only by database roles with vault access,
--                 | not by anon/authenticated.
--   Documentation | Reviewed by Bashir (Project Leader) as part of the F126 PR.
--
-- Reversibility: paired rollback in
-- ../rollback/20260902120100_schedule_scheduled_outreach_cron.down.sql

select cron.schedule(
  'scheduled_outreach_delivery',
  '*/5 * * * *', -- every five minutes; see latency rationale above
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/scheduled-outreach?x-vercel-protection-bypass='
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
