-- Rollback for 20261003130100_backfill_charity_activities_from_latest_payload.sql
--
-- Intentionally a no-op. The forward migration only fills charity_activities
-- where it is null, from the payload the row was promoted from — there is no
-- previous value to restore, and nulling the column would destroy missions
-- that later refreshes legitimately wrote. The values are reproducible: the
-- forward migration itself reproduces them exactly.

select 1;
