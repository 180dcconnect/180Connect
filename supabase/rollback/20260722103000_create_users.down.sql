-- Rollback for: 20260722103000_create_users.sql
-- Sequence step 2/17 — F016 / F017 / F224 (#219)
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING: this drops the USERS table and every row in it. On staging or
-- production that is account data — roles, activation state and the invite chain.
-- It cannot be reconstructed from auth.users, which holds no role. Take a backup
-- first (SOP §8), and note that nearly every later table has a foreign key to
-- USERS, so those must be rolled back before this will succeed.

drop trigger if exists users_guard_privileged_columns on public."USERS";
drop trigger if exists users_set_updated_at on public."USERS";

drop policy if exists users_update on public."USERS";
drop policy if exists users_select on public."USERS";

drop index if exists public.users_email_lower_key;

drop table if exists public."USERS";

drop type if exists public.user_role;

-- app.set_updated_at is generic and shared with later table migrations. Drop it
-- only if this is the last table using it; the drop fails while any trigger
-- references it, which is the intended guard.
drop function if exists app.set_updated_at();
