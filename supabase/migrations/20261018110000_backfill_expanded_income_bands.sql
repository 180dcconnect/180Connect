-- Backfill income bands after 20261005090000 has committed the new enum values.
-- PostgreSQL does not allow an enum value added in the current transaction to
-- be used until that transaction commits, so this cannot live beside ALTER TYPE.

update public.financial_periods
   set income_band = case
     when total_income < 10000 then 'under_10k'::public.income_band
     when total_income <= 100000 then '10k_100k'::public.income_band
     when total_income <= 500000 then '100k_500k'::public.income_band
     when total_income <= 1000000 then '500k_1m'::public.income_band
     when total_income <= 10000000 then '1m_10m'::public.income_band
     when total_income <= 50000000 then '10m_50m'::public.income_band
     when total_income <= 100000000 then '50m_100m'::public.income_band
     else 'over_100m'::public.income_band
   end
 where total_income is not null;
