-- Rollback for 20260818100500_block_personal_email_manual_entry (F247 #242).

drop trigger if exists manual_entry_records_check_personal_email on public.manual_entry_records;
drop function if exists public.check_manual_entry_contact_email();
