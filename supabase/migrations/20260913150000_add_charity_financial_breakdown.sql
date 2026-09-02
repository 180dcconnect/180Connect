-- Migration: add_charity_financial_breakdown
-- Story: financial coverage — capturing what the Charity Commission already
--   hands us in the same call, instead of throwing it away.
-- Purpose: widen FINANCIAL_PERIODS with the income and expenditure split the
--   register publishes per filed year, and record two facts about a charity's
--   filing position on ORGANISATIONS so the app can tell "has not filed yet"
--   apart from "has nothing to file".
--
-- Why now: charityfinancialhistory returns the full SOFA breakdown for every
-- one of the five years it publishes — donations and legacies, charitable
-- activities, trading, investment, endowments, and the two that no other source
-- gives us at all, income from government grants and income from government
-- contracts — plus the spend side split by charitable activities, raising
-- funds, governance, grants to institutions and investment management. We were
-- fetching all of it and keeping two numbers.
--
-- "How much of this charity's income is government money" is a materially
-- different outreach conversation from "how big are they", and it is the one
-- question this data answers that nothing else in the system can.
--
-- Every column is nullable: the register publishes a partial breakdown for
-- smaller charities (an entry-level annual return files totals only), and a
-- null here means "not published for this year", never zero. Nothing computes a
-- total from these — total_income and total_expenditure stay authoritative, and
-- the parts are not guaranteed to sum to them.
--
-- ORGANISATIONS gains two columns rather than a new table: they are one-to-one
-- facts about the organisation, both already in the charitydetailsmulti payload
-- the weekly refresh fetches anyway.
--   registered_on              — date the charity entered the register. Without
--                                it the UI cannot distinguish a charity too new
--                                to have filed (the overwhelming majority of
--                                what discovery imports) from one that is
--                                overdue, and both currently render as an empty
--                                Financials tab with no explanation.
--   charity_reporting_status   — the register's own word for where the charity
--                                stands ("New", "Submission Received", …). Text
--                                rather than an enum: it is the regulator's
--                                vocabulary, not ours, and a new value must not
--                                fail an ingestion run.
--
-- Schema change approval record (SOP §7):
--   Change        | 14 nullable numeric columns on FINANCIAL_PERIODS; 2 nullable
--                 | columns (date, text) on ORGANISATIONS.
--   Reason        | The Charity Commission publishes a full income/expenditure
--                 | breakdown per filed year, including government grant and
--                 | contract income, in the same call that produces the totals
--                 | we already store. Registration date and reporting status
--                 | make an empty Financials tab explainable instead of blank.
--   Compatibility | Additive and nullable. No existing column changes type or
--                 | nullability; no existing row is rewritten; every current
--                 | select keeps working unchanged.
--   Data migration| None. The weekly refresh
--                 | (src/lib/ingestion/sources/charity-commission-financial-refresh.ts)
--                 | backfills these as it revisits each charity; a one-off
--                 | catch-up is npm run backfill:charity-financials.
--   Security      | No new table, so no new RLS surface: both tables keep their
--                 | existing policies, which are column-agnostic. The new
--                 | columns hold published regulatory data — nothing personal,
--                 | nothing commercially confidential.
--   Documentation | The Data Model spreadsheet (SOP §7) is the source of truth
--                 | and must be updated to match before this reaches production;
--                 | run npm run export:data-model afterwards so docs/data-model/
--                 | reflects it. Reviewed by Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260913150000_add_charity_financial_breakdown.down.sql

alter table public.financial_periods
  add column if not exists income_donations_legacies      numeric,
  add column if not exists income_charitable_activities   numeric,
  add column if not exists income_other_trading           numeric,
  add column if not exists income_investment              numeric,
  add column if not exists income_endowments              numeric,
  add column if not exists income_other                   numeric,
  add column if not exists income_govt_grants             numeric,
  add column if not exists income_govt_contracts          numeric,
  add column if not exists expenditure_charitable_activities numeric,
  add column if not exists expenditure_raising_funds      numeric,
  add column if not exists expenditure_governance         numeric,
  add column if not exists expenditure_grants_institutions numeric,
  add column if not exists expenditure_investment_management numeric,
  add column if not exists expenditure_other              numeric;

comment on column public.financial_periods.income_govt_grants is
  'Income from government grants for the period, as published in the charity''s '
  'annual return. Null means the register published no figure, never zero.';

comment on column public.financial_periods.income_govt_contracts is
  'Income from government contracts for the period, as published in the '
  'charity''s annual return. Null means not published, never zero.';

comment on column public.financial_periods.income_donations_legacies is
  'Annual-return income breakdown. These parts are not guaranteed to sum to '
  'total_income — smaller charities file totals only. total_income stays '
  'authoritative; nothing derives it from these columns.';

alter table public.organisations
  add column if not exists registered_on date,
  add column if not exists charity_reporting_status text;

comment on column public.organisations.registered_on is
  'Date the organisation entered its register (Charity Commission '
  'date_of_registration today). Lets the app explain an empty Financials tab: a '
  'charity registered eight months ago has filed nothing because none is due '
  'yet, which is a different fact from having filed nothing while overdue.';

comment on column public.organisations.charity_reporting_status is
  'The register''s own reporting_status for a charity ("New", "Submission '
  'Received", …). Deliberately text, not an enum: it is the regulator''s '
  'vocabulary, and a value we have not seen before must not fail an ingestion run.';
