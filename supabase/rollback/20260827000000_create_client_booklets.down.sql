-- Rollback for: 20260827000000_create_client_booklets.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Drops the saved-booklet table. Every saved booklet is regenerable from Gemini (it is
-- a cache of a generation, not a unique record like NOTES), so this is safe to run —
-- the only cost is that the next page open re-bills a generation instead of reading
-- the cached one.

drop table if exists public.client_booklets;
