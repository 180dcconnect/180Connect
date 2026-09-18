-- Restore the four-band values when rolling back the post-commit backfill.

update public.financial_periods
   set income_band = case
     when total_income < 10000 then 'under_10k'::public.income_band
     when total_income <= 100000 then '10k_100k'::public.income_band
     when total_income <= 1000000 then '100k_1m'::public.income_band
     else 'over_1m'::public.income_band
   end
 where total_income is not null;
