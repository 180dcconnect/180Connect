-- Migration: backfill_charity_activities_from_latest_payload
--
-- WHY THIS MIGRATION EXISTS: 20260923131000_add_charity_activities backfilled
-- charity_activities from the payloads rows were promoted from — but only for
-- rows that existed then. Any charity imported since (notably 2026
-- registrations, which file no activities until their first annual return)
-- landed with a null mission, and re-running an import could never heal it:
-- flagIfDuplicate short-circuits an already-imported charity before the
-- annotation runs (src/lib/standardize/write-organisations.ts). The promote
-- paths now backfill the mission on the duplicate path going forward; this
-- re-runs the same idempotent backfill for everything imported in between.
--
-- Schema change approval record (SOP §7):
--   Change        | None. Data-only: fills a nullable column, adds nothing.
--   Reason        | Heal charity_activities for charities imported after the
--                 | first backfill ran, so their Mission tick and AI prompts
--                 | read filed text instead of "Not provided".
--   Compatibility | Writes only where the column is still null, same
--                 | idempotence as the original backfill. Re-running is a
--                 | no-op. No schema, type or nullability change; no existing
--                 | select breaks.
--   Data migration| Yes — this migration IS the data migration. Copies from
--                 | RAW_SOURCE_RECORDS payloads that are already
--                 | data-handling-cleared (F246/F247 run applyDataHandling
--                 | before the row is written, src/lib/ingestion/runner.ts),
--                 | so this copies post-policy data, never the raw original.
--   Security      | Same as the original backfill: published regulatory text,
--                 | nothing personal. Externally authored free text — every
--                 | reader already treats it as untrusted input (PRD §11.5).
--   Documentation | No Data Model change: no table, column or meaning changes.
--
-- Rollback: ../rollback/20261003130100_backfill_charity_activities_from_latest_payload.down.sql

-- Newest payload per organisation wins, so the value matches the most recent
-- register snapshot. nullif keeps blanks out — an empty description is an
-- absent one, and "" would defeat every `is null` check downstream.
with latest_bulk as (
  select distinct on (r.matched_organisation_id)
         r.matched_organisation_id as organisation_id,
         nullif(btrim(r.raw_payload -> 'charity' ->> 'charity_activities'), '') as activities
    from public.raw_source_records as r
   where r.record_source = 'charity_commission_bulk'
     and r.matched_organisation_id is not null
   order by r.matched_organisation_id, r.received_at desc, r.id desc
)
update public.organisations as o
   set charity_activities = latest_bulk.activities
  from latest_bulk
 where latest_bulk.organisation_id = o.id
   and latest_bulk.activities is not null
   and o.charity_activities is null;
