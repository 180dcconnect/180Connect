-- Migration: add_ingestion_runs_records_flagged
-- Story: F049 — Weekly Data Refresh Job.
-- Purpose: F049 AC3 requires a weekly status-recheck run's history to show "success
--   or failure, number of records flagged", visible to admins the same way F039's
--   import-status page already shows fetched/inserted/skipped/failed. Before this
--   migration, the flagged count only ever existed transiently — the cron route's
--   JSON response and a digest email that is skipped entirely when there is nothing
--   to report — so there was no way to look back at a past run and see how many
--   records it flagged, unlike every other outcome count. This applies to both
--   status-recheck jobs (Companies House and Charity Commission), not just the one
--   this PR adds, since ingestion_runs is shared and the gap was identical for both.
--
-- Schema change approval record (SOP §7):
--   Change        | Add INGESTION_RUNS.records_flagged (integer, not null, default 0).
--   Reason        | F049 AC3: a status-recheck run's flagged count must be part of
--                 | the persistent, queryable run history, not just an ephemeral
--                 | email/JSON response.
--   Compatibility | Additive only. Existing rows default to 0 (correct: no run before
--                 | this migration recorded a flagged count to backfill).
--   Data migration| None — default value covers existing rows.
--   Security      | None — no RLS change. Written by the same service-role status-
--                 | recheck jobs that already write records_fetched/inserted/skipped/
--                 | failed on this table; no new write path or role is introduced.
--   Documentation | docs/data-model/03-raw-data.md is generated from the Data Model
--                 | spreadsheet (SOP §7) — this PR does not hand-edit it; the
--                 | spreadsheet's INGESTION_RUNS tab needs a matching records_flagged
--                 | column added by whoever holds edit access, then
--                 | `npm run export:data-model` re-run.
--
-- Reversibility: paired rollback in
-- ../rollback/20260811090300_add_ingestion_runs_records_flagged.down.sql

alter table public.ingestion_runs
  add column records_flagged integer not null default 0;

comment on column public.ingestion_runs.records_flagged is
  'Set only by a status-recheck run (Companies House or Charity Commission): how '
  'many records it flagged into organisation_status_flags for admin review. Zero '
  '(the default) for every other kind of ingestion run, which never flags anything.';
