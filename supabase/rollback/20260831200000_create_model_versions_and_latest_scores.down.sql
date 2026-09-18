-- Rollback for: 20260831200000_create_model_versions_and_latest_scores.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Drops the score cache and the model-version register. Every LATEST_SCORES row is
-- reproducible from the rule engine (scripts/backfill-priority-scores.mts recomputes
-- it from organisation data), so dropping loses no source data — only the cache,
-- which refills on the next backfill/rescore pass. F058/F059's filter and sort fall
-- back to treating every client as unscored until it does.

drop table if exists public.latest_scores;
drop table if exists public.model_versions;
