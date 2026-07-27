-- Backfilled from 180connect-staging (applied there 26 Jul 2026, file was missing).
-- The enforcement that is actually live: a BEFORE INSERT trigger on auth.users, so
-- the domain rule holds for every sign-up path (hook config, admin API, SQL) rather
-- than only the one the auth hook covers.

-- 1. Create or update the Postgres validation function
create or replace function public.check_180dc_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text;
begin
  user_email := new.email;

  -- Block insertion if the email is missing or doesn't end with @180dc.org
  if user_email is null or user_email not ilike '%@180dc.org' then
    raise exception 'Only @180dc.org email addresses are permitted.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- 2. Drop the trigger if it exists so re-runs don't fail
drop trigger if exists enforce_180dc_domain_on_signup on auth.users;

-- 3. Attach the trigger to fire BEFORE every insert on auth.users
create trigger enforce_180dc_domain_on_signup
  before insert on auth.users
  for each row
  execute function public.check_180dc_email_domain();
