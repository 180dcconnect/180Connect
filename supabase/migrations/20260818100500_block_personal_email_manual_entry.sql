-- Migration: block_personal_email_manual_entry
-- Story: F247 Personal Data Exclusion (#242)
-- Closes: F247 AC3 across manual entry (F036) and URL import (F037)
-- Depends on: 20260817130000_create_manual_entry_records,
--             20260818100400_add_personal_data_exclusion
--
-- PURPOSE: F036 (manual entry) and F037 (URL import) both store contact addresses
--   in public.manual_entry_records.contact_email. Technical Brief §5 Data & Legal
--   Risks (1) bans personal email addresses in any form.
--
--   This trigger ensures that any attempt to save or submit a personal email
--   address to manual_entry_records is rejected at the database boundary, using
--   the app.is_personal_email() detector and personal_email_role_parts allow-list.
--
-- Reversibility: paired rollback in
-- ../rollback/20260818100500_block_personal_email_manual_entry.down.sql

create or replace function public.check_manual_entry_contact_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.contact_email is not null and app.is_personal_email(NEW.contact_email) then
    raise exception 'personal email addresses are not permitted: contact_email must be a role address'
      using errcode = '22023';
  end if;
  return NEW;
end;
$$;

comment on function public.check_manual_entry_contact_email is
  'Trigger function enforcing personal email exclusion on manual_entry_records (F247 AC3).';

create trigger manual_entry_records_check_personal_email
  before insert or update of contact_email on public.manual_entry_records
  for each row execute function public.check_manual_entry_contact_email();
