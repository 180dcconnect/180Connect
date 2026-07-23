-- Rollback for: 20260722103200_create_rls_helpers.sql
-- Sequence step 3a/17 — F224 (#219)
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING: the per-table RLS policies from step 4 onward (notes, tags, outreach)
-- reference these predicates. Dropping them while a policy still uses them fails,
-- and forcing it with CASCADE would drop those policies too — leaving the tables
-- with RLS on and no policy, which denies all non-service-role access. Roll back the
-- table migrations that use them first.
--
-- Does not touch public.is_admin / public.is_active_user — those belong to
-- create_users (F233) and its own rollback.

drop function if exists app.can_contact_organisation(uuid);
drop function if exists app.organisation_is_unowned(uuid);
drop function if exists app.owns_organisation(uuid);
drop function if exists app.can_write();
drop function if exists app.is_cam();

drop schema if exists app;
