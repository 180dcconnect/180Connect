-- Migration: schedule_charity_commission_financials_cron
-- Story: financial coverage — keeping FINANCIAL_PERIODS filled for charities we
--   already hold.
-- Purpose: schedule the weekly Charity Commission financial refresh via pg_cron
--   + pg_net, calling the CRON_SECRET-protected route handler
--   (src/app/api/cron/charity-commission-financials) that does the actual work.
--   Same convention, same three vault secrets, as
--   20260811090200_schedule_charity_commission_cron.sql — including the Vercel
--   deployment-protection bypass query param.
--
-- Why this job exists at all: discovery searches the register *forward from a
-- registration watermark*, so it only ever imports charities registered since
-- the last run — the one cohort that has filed no accounts yet. The register's
-- financial data is fine; we were asking about the wrong charities. This job
-- asks about the ones already in ORGANISATIONS.
--
-- Wednesday, not Tuesday or Friday: the two existing Charity Commission jobs
-- hold those slots, and three weekly calls to the same upstream API want
-- separating rather than stacking.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job calling net.http_post against the
--                 | new financial-refresh cron route handler.
--   Reason        | FINANCIAL_PERIODS covered 5 of 1,947 organisations because
--                 | nothing ever asked the register about charities we already
--                 | held. Income drives the SCOUT size factor, the client-list
--                 | income filter and the CAM income-band preference, all of
--                 | which were reading an empty table.
--   Compatibility | New scheduled job only. No table changes. Depends on
--                 | 20260809100000_enable_cron_extensions.sql (pg_cron, pg_net)
--                 | and the vault secrets already created per environment.
--   Data migration| None. The one-off catch-up is a script
--                 | (npm run backfill:charity-financials), not a migration.
--   Security      | The route handler checks CRON_SECRET before doing any work
--                 | (401 otherwise). The vault secret is readable only by database
--                 | roles with vault access, not by anon/authenticated. The job
--                 | writes only FINANCIAL_PERIODS, via the service role.
--   Documentation | Reviewed by Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260923102000_schedule_charity_commission_financials_cron.down.sql

-- Unschedule-first: pg_cron's schedule() never dedupes by job name, so a
-- re-apply (e.g. after an untracked apply left the job behind) would run the
-- sweep twice. Conditional form: unscheduling a missing job is an error, not
-- a harmless false. From scratch the where-clause is empty and the schedule
-- below stands.
select cron.unschedule('charity_commission_financial_refresh_weekly')
where exists (
  select 1 from cron.job where jobname = 'charity_commission_financial_refresh_weekly'
);

select cron.schedule(
  'charity_commission_financial_refresh_weekly',
  '0 3 * * 3', -- Wednesday 03:00 UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/charity-commission-financials?x-vercel-protection-bypass='
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
