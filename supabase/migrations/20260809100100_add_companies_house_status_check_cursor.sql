-- Migration: add_companies_house_status_check_cursor
-- Story: F032/F260 follow-on — automated Companies House discovery + status watch.
-- Purpose: add RAW_SOURCE_RECORDS.status_last_checked_at, a nullable cursor the
--   weekly status-recheck job uses to pick its next batch ("least recently
--   rechecked first") — a plain ordering column, not a new state table.
--
-- Schema change approval record (SOP §7):
--   Change        | Add RAW_SOURCE_RECORDS.status_last_checked_at timestamptz.
--   Reason        | The status-recheck job (companies-house-status-recheck.ts)
--                 | rechecks a bounded batch per run, not every companies_house
--                 | record at once — it needs a way to order "which batch is next"
--                 | that survives across runs.
--   Compatibility | One nullable column on an existing table; null on every
--                 | pre-existing row, which reads correctly as "never rechecked",
--                 | sorting first — exactly the batch that should go first.
--   Data migration| None.
--   Security      | No RLS change: this is an extra column on public.raw_source_records,
--                 | whose existing admin-only SELECT policy already covers it. Only
--                 | written by the status-recheck job's service-role client (never
--                 | granted to authenticated/anon — see create_raw_source_records.sql),
--                 | so no new grant is needed.
--   Documentation | Data Model tab 03 (Raw Data) — add the column alongside the
--                 | existing RAW_SOURCE_RECORDS row. Approved by Bashir (Project
--                 | Leader), 9 Aug 2026.
--
-- Reversibility: paired rollback in
-- ../rollback/20260809100100_add_companies_house_status_check_cursor.down.sql

alter table public.raw_source_records
  add column status_last_checked_at timestamptz;

comment on column public.raw_source_records.status_last_checked_at is
  'When the Companies House status-recheck job last refetched this record''s '
  'company_status (companies-house-status-recheck.ts). Null means never rechecked, '
  'which sorts first — the batch picker orders ascending on this column so a never- '
  'checked record is always due before one checked recently. Only meaningful for '
  'record_source = ''companies_house''; unused by every other source.';

create index raw_source_records_status_check_idx
  on public.raw_source_records (status_last_checked_at)
  where record_source = 'companies_house';
