-- Migration: add_charity_commission_data_source
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" — this
--   extends the source list created at step 6.0 (create_ingestion), it does not add
--   a table.
-- Stories: F041 Standardise Client Fields — the charity_commission mapper
--   (src/lib/standardize/charity-commission.ts) and write layer
--   (src/lib/standardize/write-organisations.ts) read raw_source_records rows with
--   record_source = 'charity_commission'. Without this migration no such row can
--   ever be inserted: public.data_source_name's check constraint rejects it, so the
--   write layer would always see zero pending records.
--
-- Schema change approval record (SOP §7):
--   Change        | Add 'charity_commission' to the public.data_source_name domain
--                 | (supabase/migrations/20260728153131_create_raw_data_layer.sql).
--   Reason        | F041's write layer promotes charity_commission raw records into
--                 | organisations; the domain must accept the value before any
--                 | ingestion path can write it.
--   Compatibility | Additive only — existing values and rows are untouched. Postgres
--                 | domain constraints can be replaced in an ordinary migration
--                 | (this is why data_source_name is a domain and not an enum; see
--                 | that migration's comment).
--   Data migration| None.
--   Security      | No RLS/grant changes. Same read/write access as the existing
--                 | five source values.
--   Documentation | Data Model tab "03 Raw Data" already lists charity_commission
--                 | as a source (docs/data-model/03-raw-data.md). DATA_SOURCES in
--                 | src/lib/ingestion/type.ts updated in the same commit as this
--                 | migration, per that domain's own comment on keeping the two in
--                 | sync.
--   Approved by   | Bashir (Project Leader), 2026-08-05.
--
-- Reversibility: paired rollback in
-- ../rollback/20260805171900_add_charity_commission_data_source.down.sql

alter domain public.data_source_name
  drop constraint data_source_name_check;

alter domain public.data_source_name
  add constraint data_source_name_check
  check (value in
    ('charitybase','companies_house','360giving','find_that_charity','globalgiving','candid','charity_commission'));
