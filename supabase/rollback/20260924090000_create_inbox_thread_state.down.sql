-- Rollback for 20260924090000_create_inbox_thread_state.sql
--
-- Drops the table, its trigger functions and the enum. Reverses cleanly:
-- nothing outside this feature references any of them, and the application
-- falls back to the per-browser localStorage store
-- (src/lib/inbox/thread-flags.ts) when the table is absent.
--
-- DATA LOSS, and deliberately unmourned: every row here is one person's
-- star, read override or trash flag. There is no derived state anywhere else
-- that depends on it, and the underlying threads are untouched — an
-- organisation's outreach history lives in OUTREACH_MESSAGES and
-- REPLY_EVENTS, not here.
--
-- Run the paired 20260924090100 rollback FIRST, or the cron job survives and
-- fails nightly against a function that no longer exists.

drop table if exists public.inbox_thread_state;
drop function if exists public.prune_inbox_thread_state();
drop function if exists public.enforce_inbox_trash_cap();
drop type if exists public.inbox_read_state;
