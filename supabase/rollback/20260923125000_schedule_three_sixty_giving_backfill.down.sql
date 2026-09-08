-- Rollback: schedule_three_sixty_giving_backfill
--
-- Unschedules the 360Giving backfill drain. Grants already fetched stay; the
-- queue simply stops draining, and organisations.grants_fetched_at keeps
-- whatever it holds. The per-client button on the record keeps working, since it
-- does not go through this job.

select cron.unschedule('three_sixty_giving_backfill');
