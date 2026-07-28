-- Rollback for: 20260726112609_enforce_180dc_email_trigger.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING: this removes the only live enforcement of the @180dc.org sign-up rule.
-- After this, any email domain can create an auth user. Do not run it on a shared
-- environment unless another control replaces it.

drop trigger if exists enforce_180dc_domain_on_signup on auth.users;
drop function if exists public.check_180dc_email_domain();
