-- Rollback for: 20260913160000_add_charity_commission_bulk_data_source.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Refuses rather than silently orphans: any raw_source_records row already
-- written with this source must be dealt with first, because the restored
-- constraint would reject it and leave the table failing validation on every
-- subsequent write.

do $$
begin
  if exists (
    select 1 from public.raw_source_records
    where record_source = 'charity_commission_bulk'
  ) then
    raise exception
      'raw_source_records still holds charity_commission_bulk rows — delete or re-source them before rolling this back.';
  end if;
end $$;

alter domain public.data_source_name
  drop constraint data_source_name_check;

alter domain public.data_source_name
  add constraint data_source_name_check
  check (value in
    ('charitybase','companies_house','360giving','find_that_charity','globalgiving',
     'candid','charity_commission','website'));
