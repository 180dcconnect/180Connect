-- Rollback for: 20260913150000_add_charity_financial_breakdown.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Destructive: drops the captured breakdown. Re-running the weekly refresh
-- after re-applying the migration repopulates it from the register.

alter table public.organisations
  drop column if exists charity_reporting_status,
  drop column if exists registered_on;

alter table public.financial_periods
  drop column if exists expenditure_other,
  drop column if exists expenditure_investment_management,
  drop column if exists expenditure_grants_institutions,
  drop column if exists expenditure_governance,
  drop column if exists expenditure_raising_funds,
  drop column if exists expenditure_charitable_activities,
  drop column if exists income_govt_contracts,
  drop column if exists income_govt_grants,
  drop column if exists income_other,
  drop column if exists income_endowments,
  drop column if exists income_investment,
  drop column if exists income_other_trading,
  drop column if exists income_charitable_activities,
  drop column if exists income_donations_legacies;
