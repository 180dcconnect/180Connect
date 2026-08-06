-- Rollback for 20260805100000_create_user_onboarding.sql
--
-- Drops the F255 first-run guide state: the two USERS columns and the per-step table.
--
-- What this discards: every record of who has completed or dismissed onboarding. On a
-- re-apply, every CAM whose account is activated sees the guide again from step zero,
-- including CAMs who finished it months earlier — the predicate that decides whether to
-- show the guide reads exactly the columns this file drops. That is an annoyance rather
-- than data loss (nothing else in the schema references onboarding state), but it is the
-- reason not to run this casually against staging while people are using the guide.
--
-- Order matters: the table goes before the columns only for readability — they are
-- independent. Policies are dropped explicitly ahead of the table so a partial failure
-- cannot leave a policy naming a table on its way out.

drop policy if exists user_onboarding_steps_insert_own on public.user_onboarding_steps;
drop policy if exists user_onboarding_steps_select_own on public.user_onboarding_steps;

drop table if exists public.user_onboarding_steps;

-- The column grant goes with the columns; revoking first keeps the privilege from
-- outliving them in a partially-applied rollback.
revoke update (onboarding_completed_at, onboarding_dismissed_at)
  on public.users from authenticated;

alter table public.users
  drop column if exists onboarding_dismissed_at,
  drop column if exists onboarding_completed_at;
