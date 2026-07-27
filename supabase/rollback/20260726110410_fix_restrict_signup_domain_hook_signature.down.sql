-- Rollback for: 20260726110410_fix_restrict_signup_domain_hook_signature.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- If the "before user created" auth hook is pointed at this function in the
-- project's Auth settings, unset it there FIRST — dropping the function while the
-- hook still references it makes every sign-up fail.

drop function if exists public.restrict_signup_domain(jsonb);
