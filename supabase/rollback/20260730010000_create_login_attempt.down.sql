-- Rollback for 20260730010000_create_login_attempt.sql
--
-- Drops the F227 login throttle: the counter table and its RPCs. Dropping the table
-- discards in-flight blocks, which is the intended effect — the throttle is gone, so
-- nothing should still be held by it.
--
-- Functions are dropped before the table even though none of them is a dependency of it,
-- so that a partial failure leaves no RPC pointing at a table that is on its way out.

drop function if exists public.prune_login_attempts();
drop function if exists public.clear_login_failures(text);
drop function if exists public.record_login_failure(text);
drop function if exists public.login_throttle_state(text);
drop function if exists public.login_throttle_free_attempts();
drop function if exists public.login_throttle_window();

drop policy if exists login_attempt_select_admin on public.login_attempt;

drop table if exists public.login_attempt;
