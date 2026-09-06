-- Migration: add_ingestion_run_stats
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" — this
--   adds one nullable column to INGESTION_RUNS, created at step 6.0
--   (create_ingestion). Same shape as 20260810120000_add_records_flagged.sql.
-- Story: making the bulk import's filter legible — recording *why* 185,574
--   charities became 4,704, not only that they did.
--
-- The Charity Commission bulk adapter already computes a funnel as it streams
-- (BulkImportStats in src/lib/ingestion/sources/charity-commission-bulk.ts):
-- scanned → registered → passed the income floor → passed the sector whitelist →
-- accepted, plus the annual-return row count. Today it goes to an `onStats`
-- callback that prints it to a terminal nobody is watching, and is then dropped.
--
-- That funnel is the only thing that answers the two questions an admin actually
-- has about this import — "why is charity X not in the list" and "did someone
-- widen the filter" — so it belongs on the run, next to the counts it explains.
-- A filter change that quietly takes accepted from 4,704 to 40,000 is visible in
-- one glance at two consecutive runs and invisible in every other record we keep.
--
-- Why a jsonb column rather than typed columns:
--
--   The funnel's *stages* are source-specific. Charity Commission bulk filters on
--   income/sector/area; a future source would have entirely different gates.
--   Typed columns would mean a migration per source and a table where most
--   columns are null for most rows. Nothing in the database reads inside this
--   value — no constraint, no index, no view — it is written whole by the runner
--   and read whole by the admin page, which is exactly what jsonb is for.
--
--   Deliberately NOT where anything authoritative lives. records_fetched and the
--   rest stay the counts of record; run_stats is commentary on how the source
--   arrived at them. Nothing computes from it.
--
-- Null means the source reported no stats, which is every source but the bulk
-- import today, and every run recorded before this migration. It is not zero.
--
-- Schema change approval record (SOP §7):
--   Change        | 1 nullable jsonb column on INGESTION_RUNS.
--   Reason        | The bulk import's accept/reject funnel is computed and then
--                 | discarded. It is the only record of why the filter selected
--                 | what it selected, and the admin page has no way to show a
--                 | widened filter without it.
--   Compatibility | Additive and nullable. No existing column changes; no row is
--                 | rewritten; every current select keeps working unchanged.
--   Data migration| None. Runs recorded before this migration keep a null, which
--                 | reads as "this run reported no stats".
--   Security      | No new table, so no new RLS surface — INGESTION_RUNS keeps its
--                 | existing admin-only SELECT policy, which is column-agnostic.
--                 | The value holds aggregate counts of public register data:
--                 | nothing personal, nothing per-organisation.
--   Documentation | Data Model tab "04 Entities" lists INGESTION_RUNS' columns —
--                 | add run_stats there, then run npm run export:data-model.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260922103000_add_ingestion_run_stats.down.sql

alter table public.ingestion_runs
  add column if not exists run_stats jsonb;

comment on column public.ingestion_runs.run_stats is
  'Source-reported detail about how this run reached its counts — for the '
  'Charity Commission bulk import, the accept/reject funnel (charitiesScanned, '
  'registered, passedIncome, passedSector, accepted, annualReturnRows). Written '
  'whole by the ingestion runner and read whole by the admin page; nothing '
  'queries inside it and nothing derives a count from it. Null means the source '
  'reported no stats, which is every source but the bulk import — not zero.';
