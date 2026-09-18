-- Rollback: create_set_scout_weights_rpc
-- Reverses 20260903120000_create_set_scout_weights_rpc.sql (F096).
--
-- Drops the function only. MODEL_VERSIONS rows the RPC inserted are version
-- history and are deliberately left in place — deleting audit/history rows on
-- rollback would break the trail's integrity; a future re-apply simply versions
-- onward from whatever is active.

drop function if exists public.set_scout_weights(jsonb);
