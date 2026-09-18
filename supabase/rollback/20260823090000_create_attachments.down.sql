-- Rollback for 20260823090000_create_attachments.sql (F080, #83).
--
-- Drops the storage policies, then the bucket row, then the table. NOTE (F081):
-- once uploads exist this rollback orphans any stored objects — run
-- 20260824000000_add_attachment_upload.down.sql first if you need the write
-- path gone too, and only delete the bucket when its contents are confirmed
-- disposable.

drop policy if exists attachments_bucket_select_active on storage.objects;
delete from storage.buckets where id = 'client-attachments';

drop table if exists public.attachments;
