-- Migration: retire_companies_house_discovery_cron
-- Sequence: no schema change — unschedules one pg_cron job created at
--   20260809100400_schedule_companies_house_cron.sql.
-- Story: import criteria as data, not code.
--
-- WHAT THIS DOES
--
-- Stops the weekly `companies_house_discovery_weekly` job. The Thursday
-- `companies_house_status_recheck_weekly` job scheduled by the same migration
-- is deliberately left running — it watches for companies being dissolved or
-- struck off, which is a different question and still needs answering.
--
-- WHY DISCOVERY IS REDUNDANT
--
-- It ran three hard-coded tier queries (CIO legal forms, CIC subtype,
-- SIC-gated royal charter / societas) against the live advanced-search API
-- from an incorporation-date watermark, so it found companies incorporated
-- since the last run. Everything it produced, the monthly Basic Company Data
-- snapshot already contains:
--
--   * The snapshot is republished every month and compiles the whole live
--     register — the same population, one month behind at most.
--   * The staged companies-register file keeps every mission-plausible
--     company (Tier A forms, CICs, Tier C forms, SIC-superset matches), which
--     is a strict superset of what the three tier queries could return.
--   * "Incorporated since X" is now a filter over COMPANIES_REGISTER like any
--     other, which means it can also ask the question discovery structurally
--     could not: companies incorporated in *any* past period, not only since
--     the last run.
--
-- Keeping both would mean two paths creating the same organisation from two
-- payload shapes on two cadences, deduplicated after the fact — the same
-- failure the charity register redesign removed. One source of truth is the
-- point.
--
-- The API is not retired. `createCompaniesHouseAdapter` still serves the
-- single-company lookup by company number, and
-- `createCompaniesHouseStatusRecheckAdapter` still serves the Thursday status
-- watch, where hitting the API directly beats waiting for a snapshot refresh.
--
-- Schema change approval record (SOP §7):
--   Change        | Unschedule one pg_cron job. No tables, columns or functions.
--   Reason        | The staged companies register supersedes API discovery
--                 | entirely — same population, filterable on screen.
--   Compatibility | The route it called is deleted in the same commit. Nothing
--                 | else references the job.
--   Data migration| None. Organisations already imported by discovery are
--                 | untouched and keep their `companies_house` provenance.
--   Security      | No RLS or grant change.
--   Documentation | docs/ingestion.md's schedule table needs the weekly
--                 | Companies House discovery row removing.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260923132000_retire_companies_house_discovery_cron.down.sql

-- `if exists`-style guard: unschedule throws if the job is already gone, which
-- would fail a replay of this migration against a database that never had it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'companies_house_discovery_weekly') then
    perform cron.unschedule('companies_house_discovery_weekly');
  end if;
end;
$$;
