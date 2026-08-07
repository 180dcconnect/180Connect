-- Rollback for 20260807100000_redefine_outreach_status_pipeline.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING — this restores the pre-F145 five-value enum (not_started/queued/
-- contacted/replied/closed) and re-opens direct UPDATE on outreach_status. Any row
-- already carrying one of the ten F146-F155 values cannot be cast back automatically
-- (there is no defined mapping) — this rollback only works while the column is still
-- empty. Roll back only to unblock a failed deploy, and fix forward promptly.

drop function if exists public.set_outreach_status(uuid, public.outreach_status);

revoke update on public.organisations from authenticated;
grant update on public.organisations to authenticated;

alter table public.organisations alter column outreach_status drop default;
alter table public.organisations alter column outreach_status type text using outreach_status::text;
drop type public.outreach_status;

create type public.outreach_status as enum (
  'not_started',
  'queued',
  'contacted',
  'replied',
  'closed'
);

alter table public.organisations
  alter column outreach_status type public.outreach_status
  using outreach_status::public.outreach_status;
alter table public.organisations alter column outreach_status set default 'not_started';
