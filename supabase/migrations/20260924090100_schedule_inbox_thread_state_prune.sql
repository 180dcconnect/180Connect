-- Migration: schedule_inbox_thread_state_prune
-- Story: /inbox — per-viewer thread state (star, read/unread, trash).
-- Purpose: run the retention half of the trash bound created in
--   20260924090000_create_inbox_thread_state.sql.
--
--   That migration enforces the per-user CEILING (200 trashed threads,
--   oldest untrashed on the way in) inside a trigger, because a cap that
--   only fires on a schedule would let a burst past it for up to a day.
--   This one enforces the AGE limit, which a trigger cannot: nothing writes
--   to a row on the day it turns 30, so the only thing that can notice is a
--   sweep. Split for that reason and no other.
--
-- Same call as the 30 days Gmail keeps its own trash, and the same daily
-- shape as notifications_prune_daily (20260822090100). 03:40 UTC, ten
-- minutes after that one, so the two prunes never contend and a slow night
-- is attributable to one of them.
--
-- Pure SQL, so it calls the function directly rather than going out through
-- net.http_post to a route handler — there is no application logic in this
-- sweep, and a round trip through Vercel would add a failure mode (a bad
-- vault secret, an expired protection bypass) to a delete statement that
-- needs none. This is the same reasoning notifications_prune_daily follows.
--
-- Schema change approval record (SOP §7):
--   Change        | One cron.schedule(...) job calling
--                 | public.prune_inbox_thread_state().
--   Reason        | The 30-day half of the trash retention bound agreed for
--                 | a 500 MB database ceiling (Bashir, Project Leader,
--                 | 8 Sep 2026). Also sweeps rows that no longer carry any
--                 | state at all.
--   Compatibility | New scheduled job only. No table, grant or column
--                 | changes. The function it calls is created by
--                 | 20260924090000 and granted to no interactive role.
--   Data migration| None.
--   Security      | The function is SECURITY DEFINER and executable by
--                 | nobody interactive — the revoke is in 20260924090000.
--                 | The job runs as the postgres role, like every other
--                 | cron entry here.
--   Documentation | docs/rls-permission-matrix.md 3.20.
--
-- REQUIRED SETUP PER ENVIRONMENT: none. Unlike the Companies House and
-- digest jobs this needs no vault secrets, because it makes no HTTP call.
--
-- Reversibility: paired rollback in
--   supabase/rollback/20260924090100_schedule_inbox_thread_state_prune.down.sql

-- Unschedule-first: pg_cron's schedule() never dedupes by job name (see
-- 20260923102000), so a re-apply would run the prune twice. Conditional form
-- (same as the paired rollback): unscheduling a missing job is an error, not
-- a harmless false.
select cron.unschedule('inbox_thread_state_prune_daily')
where exists (
  select 1 from cron.job where jobname = 'inbox_thread_state_prune_daily'
);

select cron.schedule(
  'inbox_thread_state_prune_daily',
  '40 3 * * *',
  $$ select public.prune_inbox_thread_state(); $$
);
