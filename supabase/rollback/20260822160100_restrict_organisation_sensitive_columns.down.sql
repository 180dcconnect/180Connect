-- Rollback: restrict_organisation_sensitive_columns
-- Reverses 20260822160100_restrict_organisation_sensitive_columns.sql (F020, #23).

drop trigger if exists organisations_block_restricted_columns on public.organisations;
drop function if exists public.enforce_restricted_org_columns();
