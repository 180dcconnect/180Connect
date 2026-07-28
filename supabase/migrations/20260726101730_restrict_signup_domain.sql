-- Backfilled from 180connect-staging (applied there 26 Jul 2026, file was missing).
-- First attempt at locking sign-up to @180dc.org: a trigger-shaped function.
-- Superseded by 20260726110410 (hook signature) and 20260726112609 (the trigger
-- that is actually attached). Kept as-is because staging already recorded this
-- version — migrations are never edited after a shared apply (MIGRATIONS.md).
create or replace function public.restrict_signup_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (new.email ilike '%@180dc.org') then
    raise exception 'Only @180dc.org email addresses are permitted.';
  end if;
  return new;
end;
$$;
