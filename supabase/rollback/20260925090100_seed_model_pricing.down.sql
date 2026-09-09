-- Rollback: seed_model_pricing (F214)
--
-- Returns the table to the empty state its creating migration shipped. Note that
-- AI_GENERATIONS.cost_usd is snapshotted at generation time and is not recomputed
-- from this table, so rows already priced keep their cost; only generations made
-- after this rollback price as unknown again.

delete from public.model_pricing
 where model in ('gemini-3.6-flash', 'gemini-3.5-flash-lite');

alter table public.model_pricing
  drop column if exists source_url,
  drop column if exists confirmed_on;
