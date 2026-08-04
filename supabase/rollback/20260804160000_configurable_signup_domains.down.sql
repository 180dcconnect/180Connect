-- Rollback for 20260804160000_configurable_signup_domains.sql
--
-- Restores the hardcoded @180dc.org guard exactly as 20260726112609 left it, then
-- removes the table and the function that read it.
--
-- ORDER MATTERS. The old trigger goes back on *before* the table is dropped, so there
-- is no moment where auth.users has no domain guard at all. Rolling back in the other
-- order would leave sign-up briefly open to any address.
--
-- ANYTHING BEYOND 180dc.org STOPS WORKING. If staging permitted extra domains, the
-- accounts already created on them keep their rows — this only governs new inserts —
-- but no further sign-up on those domains is possible, and the rows in
-- app.allowed_email_domains that recorded why they were permitted are gone. Read the
-- table before running this if that history matters.

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

  if user_email is null or user_email not ilike '%@180dc.org' then
    raise exception 'Only @180dc.org email addresses are permitted.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_allowed_email_domain_on_signup on auth.users;

create trigger enforce_180dc_domain_on_signup
  before insert on auth.users
  for each row
  execute function public.check_180dc_email_domain();

-- The hook overload goes back to its own hardcoded copy (20260726110410), since the
-- table it would otherwise read is about to disappear.
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

drop function if exists public.check_allowed_email_domain();
drop table if exists app.allowed_email_domains;

-- Not restored: public.restrict_signup_domain() (no arguments), which the forward
-- migration dropped. It was never attached to anything, so nothing needs it back.
