-- Reverses 20260817140000_add_website_data_source.sql.
--
-- Rows with record_source = 'website' must be removed first, or the domain
-- constraint cannot be re-added. That deletion is deliberate and destructive:
-- run it only when no manual URL import evidence needs to be kept.
delete from public.raw_source_records where record_source = 'website';
delete from public.ingestion_runs where api_source = 'website';

alter domain public.data_source_name
  drop constraint data_source_name_check;

alter domain public.data_source_name
  add constraint data_source_name_check
  check (value in
    ('charitybase','companies_house','360giving','find_that_charity','globalgiving',
     'candid','charity_commission'));
