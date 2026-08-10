-- Reverses 20260807140000_add_charity_commission_source.sql.
alter domain public.data_source_name drop constraint data_source_name_check;
alter domain public.data_source_name add constraint data_source_name_check
  check (value in
    ('charitybase','companies_house','360giving','find_that_charity','globalgiving','candid'));
