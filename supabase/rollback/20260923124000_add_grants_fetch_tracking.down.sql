-- Rollback: add_grants_fetch_tracking
--
-- Drops the 360Giving backfill queue marker. Safe: nothing outside the backfill
-- job and the admin progress card reads it, and both are removed by rolling back
-- the same commit.
--
-- What is lost is the memory of which organisations have already been asked
-- about. Grants themselves are untouched — they live in GRANTS and were promoted
-- from RAW_SOURCE_RECORDS. Re-applying this migration starts every organisation
-- at null again, so the queue simply re-walks; that costs API time, not data.

drop index if exists public.organisations_grants_fetched_at_idx;

alter table public.organisations
  drop column if exists grants_fetched_at;
