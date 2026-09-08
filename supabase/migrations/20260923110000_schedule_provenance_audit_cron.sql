-- Migration: schedule_provenance_audit_cron
-- Story: F221 — audit-log pattern; the scheduled counterpart to the
--   "every client has at least one source" invariant.
-- Purpose: schedule the daily provenance-gap audit via pg_cron + pg_net,
--   calling the CRON_SECRET-protected route handler
--   (src/app/api/cron/provenance-audit) that runs the sweep. Same convention
--   as the stall-detection job (20260912150000), including the Vercel
--   deployment-protection bypass query param and the same three vault secrets.
--
-- Daily, in the same quiet window as the other daily jobs — but at 04:41, not
-- 04:17: the stall sweep holds 04:17 and the notification prune 03:30, and one
-- HTTP call for an RPC read plus a diff is not worth a collision with either.
--
-- REQUIRED ONE-TIME SETUP PER ENVIRONMENT: none beyond what
-- 20260809100400_schedule_companies_house_cron.sql already required — this
-- reuses the same three vault secrets, already created per environment.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job calling net.http_post against the
--                 | provenance-audit cron route handler.
--   Reason        | The provenance invariant ("no source = ingestion gap") must
--                 | be watched automatically, not only when someone happens to
--                 | open a client record with an empty Data Sources card.
--   Compatibility | New scheduled job only. No table changes. Depends on
--                 | 20260809100000_enable_cron_extensions.sql (pg_cron, pg_net)
--                 | and get_unprovenanced_organisations (20260923105000).
--   Data migration| None.
--   Security      | The route handler checks CRON_SECRET before doing any work
--                 | (401 otherwise). The sweep runs as service_role and writes
--                 | only to audit_log (append-only).
--   Documentation | Reviewed as part of this PR.
--
-- Reversibility: cron.unschedule('provenance_audit_daily').

select cron.schedule(
  'provenance_audit_daily',
  '41 4 * * *', -- daily 04:41 UTC — quiet window, clear of 04:17 (stall) and 03:30 (prune)
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/provenance-audit?x-vercel-protection-bypass='
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
