drop function if exists public.reject_manual_entry(uuid, text);
drop function if exists public.submit_manual_entry(text, text, text, text, text, text, text);
drop table if exists public.manual_entry_records;
drop type if exists public.manual_review_status;
