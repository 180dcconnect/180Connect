-- Rollback: link_attachments_to_timeline

alter publication supabase_realtime drop table public.attachments;

drop function if exists public.record_attachment(uuid, text, text, text, bigint, text, uuid);
drop function if exists public.link_attachment_to_timeline(uuid, uuid, text, uuid);
drop index if exists public.attachments_timeline_context_idx;

alter table public.attachments
  drop constraint if exists attachments_timeline_context_id_check,
  drop constraint if exists attachments_timeline_context_type_check,
  drop column if exists timeline_context_id,
  drop column if exists timeline_context_type;
