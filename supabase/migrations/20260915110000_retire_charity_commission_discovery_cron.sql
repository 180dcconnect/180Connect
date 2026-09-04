-- Migration: retire_charity_commission_discovery_cron
-- Sequence: no schema change — unschedules one pg_cron job created at
--   20260811090200_schedule_charity_commission_cron.sql.
-- Story: import criteria as data, not code.
--
-- WHAT THIS DOES
--
-- Stops the weekly `charity_commission_discovery_weekly` job. The Friday
-- `charity_commission_status_recheck_weekly` job scheduled by the same migration
-- is deliberately left running — it watches for charities being *removed* from
-- the register, which is a different question and still needs answering.
--
-- WHY DISCOVERY IS REDUNDANT
--
-- It searched the register's API forward from a registration watermark, so it
-- found charities registered since the last run. Everything it produced, the
-- daily bulk extract already contains:
--
--   * The extract is republished every day and carried registrations up to
--     2026-09-02 when this was written — the same freshness, one day behind.
--   * It carries the contact block discovery was valued for: an email for 87.9%
--     of charities local to the branch, a phone for 99.4%, a website for 59.4%
--     (measured 2026-09-03).
--   * "Registered since X" is now a filter over CHARITY_REGISTER like any other,
--     which means it can also ask the question discovery structurally could not:
--     charities registered in *any* past period, not only since the last run.
--
-- Keeping both would mean two paths creating the same organisation from two
-- payload shapes on two cadences, deduplicated after the fact. One source of
-- truth is the point.
--
-- The API is not retired. `createCharityCommissionLookupAdapter` still serves
-- the single-charity lookup by registration number, where hitting the API
-- directly beats waiting for a snapshot refresh.
--
-- Schema change approval record (SOP §7):
--   Change        | Unschedule one pg_cron job. No tables, columns or functions.
--   Reason        | The bulk register snapshot supersedes API discovery entirely,
--                 | including the contact details that were its main advantage.
--   Compatibility | The route it called is deleted in the same commit. Nothing
--                 | else references the job.
--   Data migration| None. Organisations already imported by discovery are
--                 | untouched and keep their `charity_commission` provenance.
--   Security      | No RLS or grant change.
--   Documentation | docs/architecture.md's ingestion section needs the weekly
--                 | Charity Commission discovery row removing.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260915110000_retire_charity_commission_discovery_cron.down.sql

-- `if exists`-style guard: unschedule throws if the job is already gone, which
-- would fail a replay of this migration against a database that never had it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'charity_commission_discovery_weekly') then
    perform cron.unschedule('charity_commission_discovery_weekly');
  end if;
end;
$$;
