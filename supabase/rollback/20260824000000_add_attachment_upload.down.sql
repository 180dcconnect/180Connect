-- Rollback: add_attachment_upload (F081)
-- Removes the upload half while leaving the F080 read half intact: the
-- ATTACHMENTS table, its SELECT policy and the bucket itself all stay.
-- Uploaded Storage objects are deliberately not touched — dropping the
-- metadata RPC does not make orphan cleanup anyone's job, same as the
-- forward migration's scope note.

drop function public.record_attachment(uuid, text, text, text, bigint);

drop policy attachments_bucket_insert_active on storage.objects;

update storage.buckets
   set file_size_limit = null,
       allowed_mime_types = null
 where id = 'client-attachments';
