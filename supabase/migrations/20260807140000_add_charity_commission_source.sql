-- Schema change approval record (SOP §7):
--   Change        | Add 'charity_commission' to the public.data_source_name domain.
--   Reason        | F033: Charity Commission adapter needs a valid source value —
--                 | the domain only covered the original six F038 sources.
--   Compatibility | Additive only; existing rows and the other five values are
--                 | untouched. No FKs affected.
--   Data migration| None.
--   Security      | None — domain constraint only, no RLS/grant changes.
--
-- TODO before this can go to staging/production: per supabase/MIGRATIONS.md,
-- the Data Model spreadsheet (table tab + "02 Data Dictionary") must be updated
-- BEFORE the migration is written. That has not happened yet — this migration
-- is local-only for now, applied to unblock F033 development/testing, pending
-- sign-off from the team lead per the documented process.
--
-- Postgres domains cannot ADD a value the way an enum can — the check
-- constraint has to be dropped and recreated with the full list.
alter domain public.data_source_name drop constraint data_source_name_check;
alter domain public.data_source_name add constraint data_source_name_check
  check (value in
    ('charitybase','companies_house','360giving','find_that_charity','globalgiving','candid','charity_commission'));