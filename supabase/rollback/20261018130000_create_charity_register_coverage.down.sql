-- Rollback for 20261018130000_create_charity_register_coverage.sql.
-- This drops derived cache rows only. Client, register and audit data are not
-- changed; the previous application path can calculate the same figures again.

drop trigger if exists organisation_identifiers_stale_charity_coverage
  on public.organisation_identifiers;
drop trigger if exists financial_periods_stale_charity_coverage
  on public.financial_periods;
drop trigger if exists organisations_stale_charity_reach_coverage
  on public.organisations;
drop trigger if exists organisations_stale_charity_profile_coverage
  on public.organisations;

drop function if exists public.fail_charity_register_coverage_refresh(text, timestamptz);
drop function if exists public.finish_charity_register_coverage_refresh(
  text, timestamptz, date, integer, integer, integer, integer
);
drop function if exists public.claim_charity_register_coverage_refreshes(date);
drop function if exists public.mark_charity_register_coverage_stale();

drop table if exists public.charity_register_coverage;
