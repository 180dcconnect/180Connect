drop function if exists public.record_attachment_text_extraction(uuid, text, text, text, integer, boolean);
drop trigger if exists attachments_initial_text_extraction_status on public.attachments;
drop function if exists public.set_initial_attachment_text_extraction_status();
drop index if exists public.attachments_extracted_text_search_idx;
alter table public.attachments
  drop column if exists extracted_text_search,
  drop column if exists extracted_text_truncated,
  drop column if exists extracted_page_count,
  drop column if exists text_extraction_failure_reason,
  drop column if exists text_extracted_at,
  drop column if exists extracted_text,
  drop column if exists text_extraction_status;
