-- Rollback for: 20260726101730_restrict_signup_domain.sql
-- Apply manually against the target DB to reverse the paired migration.
-- Nothing references this overload (it was never attached to a trigger), so
-- dropping it is safe on its own.

drop function if exists public.restrict_signup_domain();
