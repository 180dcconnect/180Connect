-- Migration: add_pdf_text_extraction
-- Story: F220 Extract Text from PDF (#215)
--
-- Schema approval record (SOP §7):
--   Change        | Adds extraction metadata and searchable text to ATTACHMENTS;
--                 | adds one SECURITY DEFINER result-recording RPC.
--   Reason        | Stored client PDFs need an explicit succeeded/failed state
--                 | and usable text for search, summaries and email context.
--   Compatibility | Additive columns only. Existing PDF rows start pending;
--                 | other existing attachments are not_applicable.
--   Data migration| Defaults/backfill are computed from content_type/filename.
--   Security      | Existing RLS SELECT policy continues to govern the row.
--                 | No direct UPDATE grant; the RPC checks app.can_write().
--   Documentation | Data Model/Data Dictionary source spreadsheet must be
--                 | updated by its owner, then npm run export:data-model.
-- Reversibility: paired rollback in
--   ../rollback/20260912170300_add_pdf_text_extraction.down.sql

alter table public.attachments
  add column text_extraction_status text not null default 'not_applicable',
  add column extracted_text text,
  add column text_extracted_at timestamptz,
  add column text_extraction_failure_reason text,
  add column extracted_page_count integer,
  add column extracted_text_truncated boolean not null default false,
  add column extracted_text_search tsvector generated always as
    (to_tsvector('english', coalesce(extracted_text, ''))) stored,
  add constraint attachments_text_extraction_status_check check (
    text_extraction_status in ('pending', 'succeeded', 'failed', 'not_applicable')
  ),
  add constraint attachments_extracted_text_state_check check (
    (text_extraction_status = 'succeeded' and extracted_text is not null and btrim(extracted_text) <> '')
    or (text_extraction_status <> 'succeeded' and extracted_text is null)
  ),
  add constraint attachments_extracted_page_count_check check (
    extracted_page_count is null or extracted_page_count > 0
  );

update public.attachments
   set text_extraction_status = 'pending'
 where content_type = 'application/pdf'
    or lower(filename) like '%.pdf';

create index attachments_extracted_text_search_idx
  on public.attachments using gin (extracted_text_search);

comment on column public.attachments.extracted_text is
  'F220: local PDF.js text projection used by search, summaries and email generation. Null unless extraction succeeded.';
comment on column public.attachments.text_extraction_status is
  'F220: pending, succeeded, failed, or not_applicable. Failed is explicit for scanned, invalid, or unreadable PDFs.';
comment on column public.attachments.extracted_text_search is
  'F220: English full-text search vector generated from extracted_text.';

create function public.set_initial_attachment_text_extraction_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.text_extraction_status := case
    when new.content_type = 'application/pdf' or lower(new.filename) like '%.pdf'
      then 'pending'
    else 'not_applicable'
  end;
  return new;
end;
$$;

create trigger attachments_initial_text_extraction_status
before insert on public.attachments
for each row execute function public.set_initial_attachment_text_extraction_status();

create or replace function public.record_attachment_text_extraction(
  p_attachment_id uuid,
  p_status text,
  p_text text default null,
  p_failure_reason text default null,
  p_page_count integer default null,
  p_truncated boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_write() then
    raise exception 'only a CAM or admin can record PDF text extraction' using errcode = '42501';
  end if;
  if p_status not in ('succeeded', 'failed', 'not_applicable') then
    raise exception 'invalid extraction status' using errcode = '22023';
  end if;
  if p_status = 'succeeded' and btrim(coalesce(p_text, '')) = '' then
    raise exception 'successful extraction requires text' using errcode = '23514';
  end if;

  update public.attachments
     set text_extraction_status = p_status,
         extracted_text = case when p_status = 'succeeded' then p_text else null end,
         text_extracted_at = now(),
         text_extraction_failure_reason = case when p_status = 'failed' then left(p_failure_reason, 100) else null end,
         extracted_page_count = case when p_status = 'succeeded' then p_page_count else null end,
         extracted_text_truncated = case when p_status = 'succeeded' then coalesce(p_truncated, false) else false end
   where id = p_attachment_id;

  if not found then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke execute on function public.record_attachment_text_extraction(uuid, text, text, text, integer, boolean)
  from public, anon;
grant execute on function public.record_attachment_text_extraction(uuid, text, text, text, integer, boolean)
  to authenticated;
