-- Rollback for 20260923131000_add_charity_activities.sql
--
-- Dropping the column discards the backfilled text, which is not a loss of
-- record: every value came from RAW_SOURCE_RECORDS and the forward migration's
-- backfill reproduces it exactly. Nothing else writes this column by hand.

alter table public.organisations
  drop column if exists charity_activities;
