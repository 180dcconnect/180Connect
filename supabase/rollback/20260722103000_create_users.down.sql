-- Rollback for: 20260722103000_create_users.sql
-- Sequence step 2/17 — F233 (#228)
-- Apply manually against the target DB to reverse the paired migration.
-- WARNING: destroys every row in public.users. Roll back create_organisations first —
-- ORGANISATIONS.owner_id references this table.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user ();
drop function if exists public.is_admin ();

drop trigger if exists users_set_updated_at on public.users;
drop table if exists public.users;

-- set_updated_at is shared with later tables; only drop it after rolling back any tables that depend on it.
drop function if exists public.set_updated_at ();

drop type if exists public.user_role;
