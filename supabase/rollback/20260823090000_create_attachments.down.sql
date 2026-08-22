-- Rollback for 20260823090000_create_attachments.sql (F080, #83).
--
-- Drops the storage policy, then the bucket row, then the table. Safe to
-- delete the bucket outright: F080 ships no write path, so nothing can have
-- put an object in it yet — there is nothing in Storage to orphan.

drop policy if exists attachments_bucket_select_active on storage.objects;
delete from storage.buckets where id = 'client-attachments';

drop table if exists public.attachments;
