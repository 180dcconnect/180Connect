-- Rollback for: 20260722103000_create_users.sql
-- Sequence step 2/17 — F233 (#228)
-- Apply manually against the target DB to reverse the paired migration.
-- WARNING: destroys every row in public.users. Roll back create_organisations first —
-- ORGANISATIONS.owner_id references this table.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists app.handle_new_auth_user ();
-- app.is_admin / app.is_active_user are used by policies on public.organisations too
-- (and by app.* helpers from create_rls_helpers); roll back those first or this fails.
drop function if exists app.is_admin ();
drop function if exists app.is_active_user ();

drop trigger if exists users_set_updated_at on public.users;
drop table if exists public.users;

-- set_updated_at is shared with later tables; only drop it after rolling back any tables that depend on it.
drop function if exists public.set_updated_at ();

drop type if exists public.user_role;

-- Drop the app schema only if create_rls_helpers (F224) has already been rolled back;
-- while its functions remain, this fails, which is the intended guard.
drop schema if exists app;
