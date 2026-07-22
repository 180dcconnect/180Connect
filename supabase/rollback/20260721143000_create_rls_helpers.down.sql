-- Rollback for: 20260721143000_create_rls_helpers.sql
-- Sequence step 2a/17 — F224 (#224)
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING: every RLS policy in the schema is built on these functions. Dropping
-- them while policies reference them will fail (the dependency is real), and
-- forcing it with CASCADE would drop the policies too — leaving tables with RLS
-- enabled and zero policies, which denies all access to non-service-role users.
-- Roll back the table migrations that use them first.

-- Drop the trigger on USERS before this function, or the drop fails.
drop function if exists app.guard_privileged_user_columns();
drop function if exists app.can_contact_organisation(uuid);
drop function if exists app.organisation_is_unowned(uuid);
drop function if exists app.owns_organisation(uuid);
drop function if exists app.can_write();
drop function if exists app.is_viewer();
drop function if exists app.is_cam();
drop function if exists app.is_admin();
drop function if exists app.is_active_user();
drop function if exists app.current_user_role();

drop schema if exists app;
