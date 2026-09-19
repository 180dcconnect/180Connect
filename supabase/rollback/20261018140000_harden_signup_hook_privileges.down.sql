-- Restore the effective grants that existed before the matching hardening
-- migration. This deliberately reopens the advisor finding and is intended
-- only for emergency compatibility rollback.
grant execute on function public.restrict_signup_domain(jsonb)
  to public, anon, authenticated;

alter function public.login_throttle_window()
  reset search_path;

alter function public.login_throttle_free_attempts()
  reset search_path;
