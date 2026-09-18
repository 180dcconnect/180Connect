-- Rollback for 20261018090000_website_absent_flag.sql
-- Removes the mark entirely: the RPC, the auto-clear trigger and the two columns.
-- audit_log rows written by the RPC are left in place — the trail is append-only
-- and those changes really happened.

drop trigger if exists organisations_clear_website_absent on public.organisations;
drop function if exists public.clear_website_absent_when_website_set();

drop function if exists public.set_website_absent(uuid, boolean);

alter table public.organisations
  drop constraint if exists organisations_website_absent_pair;

alter table public.organisations
  drop column if exists website_absent_at,
  drop column if exists website_absent_by;
