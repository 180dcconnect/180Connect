drop trigger if exists sync_auth_user_after_change on auth.users;
drop function if exists public.sync_auth_user();
drop function if exists public.current_app_role();
drop table if exists public."USERS";
drop type if exists public.app_role;

