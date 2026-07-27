-- Rollback for: 20260722103100_create_organisations.sql
-- Sequence step 3/17 — F233 (#228)
-- Apply manually against the target DB to reverse the paired migration.
-- WARNING: destroys every organisation row. Run this before the create_users rollback.

drop trigger if exists organisations_set_updated_at on public.organisations;
drop table if exists public.organisations;

drop type if exists public.outreach_status;
drop type if exists public.geographic_reach;
drop type if exists public.organisation_type;
drop type if exists public.entry_method;
