-- Migration: schedule_no_response_sweep_cron
-- Story: F154 AC3 (#149) — No Response Status, automatic transition.
-- Purpose: schedule the daily no-response sweep via pg_cron + pg_net, calling
--   the CRON_SECRET-protected route handler (src/app/api/cron/no-response-
--   sweep) that calls sweep_no_response_status() (20260912170300). Same
--   convention as the stall-detection cron (20260912150000), including reuse
--   of the same three vault secrets.
--
-- Daily, not five-minute like scheduled-outreach: a status transition after a
-- multi-day silence window has no minute-level urgency, and running it once a
-- day keeps ERROR_LOG quiet while still satisfying "runs automatically on a
-- schedule" (AC3).
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: none beyond what
-- 20260809100400_schedule_companies_house_cron.sql already required — this
-- reuses the same three vault secrets, already created per environment.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job calling net.http_post against
--                 | the new no-response-sweep cron route handler.
--   Reason        | F154 AC3: the automatic no_response transition must run
--                 | on a schedule, not only when triggered by hand.
--   Compatibility | New scheduled job only. No table changes. Depends on
--                 | 20260809100000_enable_cron_extensions.sql (pg_cron,
--                 | pg_net) and the existing vault secrets already existing.
--   Data migration| None.
--   Security      | The route handler checks CRON_SECRET before doing any
--                 | work (401 otherwise) — see src/app/api/cron/
--                 | no-response-sweep/route.ts. The sweep itself runs as
--                 | service_role via the admin client and only ever moves a
--                 | client to no_response, recording an audit_log row.
--   Documentation | Reviewed as part of the F154 PR.
--
-- Reversibility: paired rollback in
-- ../rollback/20260912170400_schedule_no_response_sweep_cron.down.sql
-- (cron.unschedule('no_response_sweep_daily')).

select cron.schedule(
  'no_response_sweep_daily',
  '31 4 * * *', -- daily 04:31 UTC — same quiet window as the other daily jobs
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/no-response-sweep?x-vercel-protection-bypass='
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
