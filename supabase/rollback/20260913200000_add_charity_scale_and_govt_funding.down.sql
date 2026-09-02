-- Rollback for: 20260913200000_add_charity_scale_and_govt_funding.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Destructive: drops the captured scale and government-funding figures. Re-running
-- the bulk import after re-applying the migration repopulates them from the
-- register.

alter table public.financial_periods
  drop column if exists count_govt_contracts,
  drop column if exists count_govt_grants,
  drop column if exists receives_govt_contracts,
  drop column if exists receives_govt_grants,
  drop column if exists count_volunteers,
  drop column if exists count_employees;
