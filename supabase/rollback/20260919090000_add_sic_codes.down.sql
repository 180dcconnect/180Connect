-- Rollback for 20260919090000_add_sic_codes.sql
--
-- Dropping the column discards the backfilled codes, which is not a loss of
-- record: every value came from RAW_SOURCE_RECORDS and the forward migration's
-- backfill reproduces it exactly. Nothing else writes this column by hand —
-- there is no edit affordance for it, because it is the register's
-- classification rather than anything a CAM can correct.

alter table public.organisations
  drop column if exists sic_codes;
