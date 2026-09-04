-- Migration: schedule_three_sixty_giving_backfill
-- Sequence: no schema change — schedules one pg_cron job calling the route added
--   in the same commit (src/app/api/cron/three-sixty-giving-backfill/route.ts).
-- Story: making 360Giving enrichment finish.
--
-- WHY A SCHEDULE AT ALL
--
-- 360Giving enrichment costs one request per organisation we hold, paced at
-- 600ms to stay under their documented 2 requests/second. That is ~16 minutes
-- for the 1,915 identifiers on staging, against a 300s platform ceiling. The
-- walk cannot be one request, so it is a queue that drains a slice at a time —
-- organisations.grants_fetched_at is the cursor (20260916100000).
--
-- WHY EVERY 15 MINUTES, WHICH LOOKS AGGRESSIVE AND IS NOT
--
-- A run with an empty queue makes NO external requests. It asks one indexed
-- question — "is anything due?" — and returns. So the cost of a frequent
-- schedule is a query, not API traffic.
--
-- Frequency is what makes the batch small, and a small batch is what makes a
-- timeout cheap. At 200 organisations a run:
--
--   * a fresh import of ~800 charities clears in about an hour, not overnight;
--   * a run killed mid-slice loses 200 organisations of progress, not 1,900,
--     and the next run picks them up 15 minutes later;
--   * steady state is ~21 organisations a day (1,915 spread over the 90-day
--     refetch window), which one run absorbs and the other 95 skip entirely.
--
-- The opposite arrangement — one big nightly run — has every property reversed:
-- it is slower to reflect an import, it loses far more when it fails, and it
-- fails on exactly the night after a large import, when the queue is longest.
--
-- Nothing here is stamped until its slice has actually been fetched and
-- promoted, so a killed run is a no-op rather than a silent gap.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job. No tables, columns or functions.
--   Reason        | The 360Giving walk exceeds the serverless ceiling and must
--                 | resume across invocations; something has to drive it.
--   Compatibility | Additive. The route it calls is added in the same commit and
--                 | is a no-op when the queue is empty.
--   Security      | Same vault-held CRON_SECRET and protection-bypass as every
--                 | other job here; readable only by the scheduler, not by
--                 | anon/authenticated. No new secret.
--   Documentation | docs/ingestion.md "What runs on a schedule" gains a row.
--   Approved by   | Bashir (Project Leader).
--
-- OPERATIONAL NOTE — this job does nothing until the vault secrets exist in the
-- project it is applied to. Production's vault is currently empty, so every
-- pg_cron job there fails with "null value in column url" before making any
-- request. That is pre-existing and not introduced here, but this job will sit
-- in the same state until those three secrets are set.
--
-- Reversibility: paired rollback in
-- ../rollback/20260916110000_schedule_three_sixty_giving_backfill.down.sql

select cron.schedule(
  'three_sixty_giving_backfill',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'companies_house_cron_base_url')
      || '/api/cron/three-sixty-giving-backfill?x-vercel-protection-bypass='
      || (select decrypted_secret from vault.decrypted_secrets where name = 'vercel_protection_bypass'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
