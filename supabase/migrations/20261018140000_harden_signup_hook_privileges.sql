-- The before-user-created Auth hook is invoked by Supabase Auth, not by the
-- public Data API. Restrict it to the platform role documented for Postgres
-- Auth hooks so callers cannot use the SECURITY DEFINER function as an RPC.
revoke execute on function public.restrict_signup_domain(jsonb)
  from public, anon, authenticated;

grant execute on function public.restrict_signup_domain(jsonb)
  to supabase_auth_admin;

-- These immutable helpers return constants and already have EXECUTE revoked
-- from application roles. Pinning search_path also clears the remaining
-- mutable-search-path advisor warnings and keeps their execution context
-- explicit if they are reused later.
alter function public.login_throttle_window()
  set search_path = '';

alter function public.login_throttle_free_attempts()
  set search_path = '';
