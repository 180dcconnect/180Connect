-- Rollback of 20260923123000_create_sector_income_distribution_rpc.
--
-- The index goes too: it was added by that migration for that function's peer
-- filter, and nothing else queries organisations.sector on its own.
drop function if exists public.get_sector_income_distribution(text, uuid, numeric);
drop index if exists public.organisations_sector_idx;
