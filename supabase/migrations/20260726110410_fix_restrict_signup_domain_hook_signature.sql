-- Backfilled from 180connect-staging (applied there 26 Jul 2026, file was missing).
-- A Supabase "before user created" auth hook is called with a jsonb event and must
-- return jsonb, not a trigger. This adds that signature.
--
-- NOTE: this is an overload, not a replacement — public.restrict_signup_domain()
-- (no args, from 20260726101730) still exists alongside it. 20260726112609 is what
-- actually enforces the rule; drop the dead pair when the hook approach is retired.
create or replace function public.restrict_signup_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text;
begin
  user_email := event -> 'user' ->> 'email';

  if user_email is null or user_email not ilike '%@180dc.org' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Only @180dc.org email addresses are permitted.'
      )
    );
  end if;

  return jsonb_build_object();
end;
$$;
