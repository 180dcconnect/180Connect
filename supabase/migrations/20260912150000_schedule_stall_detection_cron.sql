-- Migration: schedule_stall_detection_cron
-- Story: F183 (#179) — Stall Detection.
-- Purpose: schedule the daily stall-detection sweep via pg_cron + pg_net,
--   calling the CRON_SECRET-protected route handler
--   (src/app/api/cron/stall-detection) that does the actual work.
--   Same convention as the data-refresh and scheduled-outreach jobs
--   (20260809100400 / 20260810100000 / 20260811090200 / 20260902120100),
--   including the Vercel deployment-protection bypass query param and reuse
--   of the same three vault secrets — companies_house_cron_base_url really
--   just holds the app's base URL (not anything Companies-House-specific
--   despite its name; kept as-is per MIGRATIONS.md's no-rename-without-
--   Wednesday-call rule).
--
-- Daily, not five-minute like scheduled-outreach: stall flags are an admin
-- oversight signal, not a delivery deadline, and the live view computes them
-- on every render anyway — the cron's job is to record an audit entry when
-- the stalled set changes (AC3) rather than to make data available. Once a
-- day keeps ERROR_LOG quiet while still satisfying "runs automatically on a
-- schedule".
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: none beyond what
-- 20260809100400_schedule_companies_house_cron.sql already required — this
-- reuses the same three vault secrets, already created per environment.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job calling net.http_post against
--                 | the new stall-detection cron route handler.
--   Reason        | F183 AC3: stall detection must run automatically on a
--                 | schedule, not only when an admin opens the view.
--   Compatibility | New scheduled job only. No table changes. Depends on
--                 | 20260809100000_enable_cron_extensions.sql (pg_cron, pg_net)
--                 | and the existing vault secrets already existing.
--   Data migration| None.
--   Security      | The route handler checks CRON_SECRET before doing any work
--                 | (401 otherwise) — see src/app/api/cron/stall-detection/
--                 | route.ts. The sweep itself runs as service_role via the
--                 | admin client and writes only to audit_log (append-only).
--   Documentation | Reviewed as part of the F183 PR.
--
-- Reversibility: cron.unschedule('stall_detection_daily').

select cron.schedule(
  'stall_detection_daily',
  '17 4 * * *', -- daily 04:17 UTC — same quiet window as other daily jobs
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/stall-detection?x-vercel-protection-bypass='
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
