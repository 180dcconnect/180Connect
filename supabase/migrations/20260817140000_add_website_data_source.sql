-- Migration: add_website_data_source
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" — this
--   extends the source list created at step 6.0 (create_ingestion), it does not add
--   a table. Same shape as 20260806110100_add_charity_commission_data_source.sql.
-- Stories: F037 Manual URL Import — a CAM-supplied website is external data, and
--   the data handling policy (docs/data-handling-policy.md §2) requires external
--   data to enter through one choke point. That choke point is RAW_SOURCE_RECORDS,
--   whose record_source column is public.data_source_name. Without this migration a
--   fetched page cannot be stored at all, and the import would have to keep its
--   evidence somewhere the retention schedule and the field-level rules do not see.
--
-- Schema change approval record (SOP §7):
--   Change        | Add 'website' to the public.data_source_name domain
--                 | (supabase/migrations/20260728153131_create_raw_data_layer.sql).
--   Reason        | F037 stores the fetched page for each manual URL import in
--                 | raw_source_records so the origin of imported values is
--                 | auditable and covered by the existing retention rules.
--   Compatibility | Additive only — existing values and rows are untouched.
--   Data migration| None.
--   Security      | No RLS/grant changes. raw_source_records stays admin-read and
--                 | service_role-write, exactly as for the API sources.
--   Documentation | Data Model tab "03 Raw Data" needs 'website' adding to the
--                 | RAW_SOURCE_RECORDS.record_source enum values. DATA_SOURCES in
--                 | src/lib/ingestion/type.ts is updated in the same commit, per
--                 | that domain's own comment on keeping the two in sync.
--   Approved by   | Pending — raised with Bashir (Project Leader) on 2026-08-17.
--
-- Note on 'website' as a source name rather than 'manual_url': the value names
-- where the data came from (an organisation's own website), not the mechanism that
-- fetched it. ORGANISATION_IDENTIFIERS.identifier_type already uses 'website' for
-- the same concept, so the two agree.
--
-- Reversibility: paired rollback in
-- ../rollback/20260817140000_add_website_data_source.down.sql

alter domain public.data_source_name
  drop constraint data_source_name_check;

alter domain public.data_source_name
  add constraint data_source_name_check
  check (value in
    ('charitybase','companies_house','360giving','find_that_charity','globalgiving',
     'candid','charity_commission','website'));
