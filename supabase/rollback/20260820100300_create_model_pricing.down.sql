-- Rollback for 20260820100300_create_model_pricing.sql

drop policy if exists model_pricing_select_active on public.model_pricing;
drop trigger if exists model_pricing_set_updated_at on public.model_pricing;
drop table if exists public.model_pricing;
