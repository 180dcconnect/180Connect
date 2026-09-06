-- Migration: add_charity_commission_bulk_data_source
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" — this
--   extends the source list created at step 6.0 (create_ingestion), it does not add
--   a table. Same shape as 20260806110100_add_charity_commission_data_source.sql and
--   20260817140000_add_website_data_source.sql.
-- Story: financial coverage — importing established charities from the Charity
--   Commission's bulk register extract rather than only newly registered ones
--   from the dated search endpoint.
--
-- Why a separate source value rather than reusing 'charity_commission':
--
--   1. The payloads are different shapes. The API's charitydetailsmulti record
--      and a row of publicextract.charity.json share a charity number and little
--      else; the standardize mapper has to know which it is holding, and
--      record_source is where every other source makes that distinction.
--   2. Deduplication is keyed on (record_source, source_record_id)
--      (20260728153131_create_raw_data_layer.sql). Sharing a value would make a
--      bulk row and an API row for the same charity collide, and whichever
--      arrived second would silently overwrite a richer payload with a thinner
--      one — or the reverse, depending on the day's run order.
--   3. The two run on different cadences against different endpoints, and when
--      one breaks we need to see which one from the ingestion_runs list alone.
--
-- The extract itself is public and unauthenticated (verified 2026-09-02:
-- publicextract.charity.zip 57MB, publicextract.charity_annual_return_history.zip
-- 28MB, both refreshed daily), so this adds no credential and no new secret.
--
-- Schema change approval record (SOP §7):
--   Change        | Add 'charity_commission_bulk' to the public.data_source_name
--                 | domain (20260728153131_create_raw_data_layer.sql).
--   Reason        | Discovery currently searches the register forward from a
--                 | registration watermark, so it imports only charities
--                 | registered since the last run — the one cohort that has filed
--                 | no accounts. 769 of 774 Charity Commission records on staging
--                 | were registered inside two years, which is why
--                 | FINANCIAL_PERIODS covered 5 organisations of 1,947. The bulk
--                 | extract carries every registered charity and its annual
--                 | return history, so an imported charity arrives with its
--                 | accounts already attached.
--   Compatibility | Additive only — existing values and rows untouched. Postgres
--                 | domain constraints are replaceable in an ordinary migration
--                 | (this is why data_source_name is a domain, not an enum).
--   Data migration| None.
--   Security      | No RLS or grant changes; same access as the existing source
--                 | values. The extract is public data published by the regulator.
--   Documentation | Data Model tab "03 Raw Data" lists the source values — add
--                 | charity_commission_bulk there, then run
--                 | npm run export:data-model. DATA_SOURCES in
--                 | src/lib/ingestion/type.ts is updated in the same commit as
--                 | this migration, per that domain's own comment on keeping the
--                 | two in sync.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260922094000_add_charity_commission_bulk_data_source.down.sql

alter domain public.data_source_name
  drop constraint data_source_name_check;

alter domain public.data_source_name
  add constraint data_source_name_check
  check (value in
    ('charitybase','companies_house','360giving','find_that_charity','globalgiving',
     'candid','charity_commission','website','charity_commission_bulk'));
