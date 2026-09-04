-- Migration: add_charity_activities
-- Story: F083 — Use Client Data in Booklet. The booklet reports
--        "Mission: Not provided" for 2,735 of 2,737 organisations, because the
--        only mission text the schema has a home for is
--        ENRICHMENT_RESULTS.mission_statement and the enrichment worker has
--        written two rows in total.
--
-- WHY THIS MIGRATION EXISTS: the Charity Commission publishes the charity's own
-- description of what it does, and we already ingest it. It travels the whole
-- pipeline — publicextract.charity.charity_activities, into
-- BulkCharityRow.charity_activities (ingestion/sources/charity-commission-bulk.ts),
-- into the stored payload — and is then dropped on the floor at the standardize
-- step, which persists sector, registration date and reporting status from the
-- same payload and nothing else. 791 organisations have this text sitting in
-- RAW_SOURCE_RECORDS with no column to land in and no CAM-readable path to it
-- (that table is admin-only by policy, deliberately).
--
-- ORGANISATIONS gains the column rather than a new table: it is a one-to-one
-- fact about the organisation, from a payload the import already fetches. This
-- is the same shape, and the same write path (annotateOrganisation), as
-- registered_on and charity_reporting_status in
-- 20260913150000_add_charity_financial_breakdown.sql.
--
-- Named charity_activities, not activities: it is the regulator's field, only
-- charities have one, and a company or CIC row leaves it null — exactly like
-- charity_reporting_status beside it. Source parity also keeps the ingestion
-- mapping self-evident.
--
-- NOT written to ENRICHMENT_RESULTS.mission_statement, which would be the
-- smaller change: that table is LLM-derived output by definition and its own
-- comment restricts it to the enrichment worker. PRD §7.8 requires AI-derived
-- data to be labelled and never silently promoted to canonical truth; filing
-- the regulator's own filed text as enrichment output is that rule run
-- backwards, and it would make a verified register fact indistinguishable from
-- a model's guess in every downstream reader.
--
-- Schema change approval record (SOP §7):
--   Change        | One nullable text column, charity_activities, on
--                 | public.organisations.
--   Reason        | Give the register's own "what this charity does" text a
--                 | canonical home so the Client Booklet (F082/F083) and the
--                 | Stage 1 email (F102) can describe what a charity actually
--                 | does. Today both are told "Mission: Not provided" for
--                 | effectively every record in the book.
--   Compatibility | Additive and nullable, no default. No existing column
--                 | changes type or nullability, no existing select breaks.
--   Data migration| Yes, and required rather than optional: annotateOrganisation
--                 | runs only on the insert path in
--                 | src/lib/standardize/write-organisations.ts, and an already
--                 | imported charity is short-circuited as a duplicate before it
--                 | is reached — so re-running the import would NOT fill this in
--                 | for the 791 organisations already promoted. The backfill
--                 | below copies the value from the payload those rows were
--                 | promoted from. Idempotent: it only writes where the column
--                 | is still null, so re-running it is a no-op.
--   Security      | No new table, so no new RLS surface — ORGANISATIONS keeps
--                 | its existing column-agnostic policies. The value is
--                 | published regulatory text: the description a charity files
--                 | about its own work. Nothing personal, nothing confidential.
--                 | It is externally authored, so every reader must treat it as
--                 | untrusted input — the booklet prompt already fences all
--                 | profile data against injection (PRD §11.5,
--                 | src/lib/booklet/build-prompt.ts).
--   Documentation | Data Model tab ORGANISATIONS needs the new row; run
--                 | npm run export:data-model to refresh docs/data-model/.
--
-- Rollback: ../rollback/20260916130000_add_charity_activities.down.sql

alter table public.organisations
  add column if not exists charity_activities text;

comment on column public.organisations.charity_activities is
  'The charity''s own description of its work, as filed with the register '
  '(Charity Commission publicextract.charity.charity_activities today). '
  'Canonical, API-sourced, and distinct from '
  'ENRICHMENT_RESULTS.mission_statement, which is LLM-derived — a reader that '
  'shows both must not present them as the same kind of claim. Externally '
  'authored free text: treat as untrusted input anywhere it reaches a model.';

-- Backfill from the payloads the existing rows were promoted from. The stored
-- payload is already data-handling-cleared (F246/F247 run applyDataHandling
-- before the row is written, src/lib/ingestion/runner.ts), so this copies
-- post-policy data, never the unfiltered original. nullif keeps a blank string
-- out — an empty description is an absent one, and "" would defeat every
-- `is null` check downstream, including this migration's own idempotence.
--
-- distinct on, not a bare UPDATE ... FROM join: an organisation can hold more
-- than one bulk raw record (a re-ingestion writes a second row when the
-- checksum changed), and a plain join would let Postgres pick between them
-- arbitrarily. Newest received_at wins, so the value matches the most recent
-- register snapshot and the migration produces the same result every run.
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
