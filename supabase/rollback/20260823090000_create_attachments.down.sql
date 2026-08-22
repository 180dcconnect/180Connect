-- Rollback for 20260823090000_create_attachments.sql (F080 #83 / F081 #84).
--
-- Drops the RPC, the storage policies, the bucket row, then the table —
-- reverse creation order. Deleting the bucket row does not delete objects
-- already uploaded into it; if any exist, drop them first
-- (`delete from storage.objects where bucket_id = 'client-attachments';`)
-- or this statement is refused by the storage schema's own constraints.
--
-- Data loss on rollback: every attachment's metadata, and — once dropped —
-- every file in the bucket.

drop function if exists public.record_attachment(uuid, text, text, text, bigint);

drop policy if exists attachments_bucket_insert_active on storage.objects;
drop policy if exists attachments_bucket_select_active on storage.objects;
delete from storage.buckets where id = 'client-attachments';

drop table if exists public.attachments;
