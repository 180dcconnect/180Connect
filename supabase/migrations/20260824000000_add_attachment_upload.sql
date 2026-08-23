-- Migration: add_attachment_upload
-- Story: F081 Upload Client Attachment (#84), on top of F080 (#83).
--
-- WHY THIS IS A SEPARATE MIGRATION: 20260823090000_create_attachments.sql
-- (the table, bucket and read policies) already ran on staging and production
-- when #452 merged. An applied migration file must never be edited in place —
-- the migration runner would see the filename as already applied and silently
-- skip everything this feature needs. So the upload half lives here instead,
-- and the earlier file stays exactly as it shipped.
--
-- WHAT F081 ADDS:
--   1. A real, Storage-enforced size cap (25 MB) and mime-type allowlist on
--      the client-attachments bucket.
--   2. An INSERT policy on storage.objects so a signed-in CAM's direct-to-
--      Storage upload can land at all.
--   3. record_attachment — the SECURITY DEFINER RPC that is the only way an
--      ATTACHMENTS metadata row gets created.
--
-- SIZE/TYPE LIMITS ARE PROVISIONAL, NOT SIGNED OFF: PRD §14 lists "Attachment
--   size/type limits" as its own open question, owned by "Security + email
--   epic owner". The values below are a reasonable working default so AC3's
--   "specific error, not a generic failure" has real behaviour to point at.
--   They are mirrored by hand in src/lib/attachments.ts
--   (MAX_ATTACHMENT_SIZE_BYTES / ALLOWED_ATTACHMENT_MIME_TYPES) for the
--   client-side fast-path check; revisit both together when the named owner
--   decides.
--
-- UPLOAD SHAPE (two steps, not one RPC that takes bytes): Postgres functions
--   don't receive multipart bodies. The browser uploads the file directly to
--   Storage — gated by the INSERT policy below and the bucket's own
--   file_size_limit/allowed_mime_types — then record_attachment writes the
--   ATTACHMENTS row once the object verifiably exists. A failure between the
--   two steps leaves an orphaned object with no metadata row: it appears in
--   nobody's list. F081's scope doesn't include a reclaim sweep.
--
-- Spec: docs/rls-permission-matrix.md §3.21
-- Reversibility: paired rollback in
--   ../rollback/20260824000000_add_attachment_upload.down.sql

-- ---------------------------------------------------------------------------
-- 1. Bucket limits: what actually enforces AC3's size/type ceiling.
-- ---------------------------------------------------------------------------

update storage.buckets
   set file_size_limit = 26214400, -- 25 MB — see the provisional-limits note above.
       allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'text/plain',
         'text/csv',
         'image/png',
         'image/jpeg',
         'image/gif',
         'image/webp'
       ]
 where id = 'client-attachments';

-- ---------------------------------------------------------------------------
-- 2. INSERT policy: lets the browser's direct-to-Storage upload land at all.
--    Not scoped to an organisation path prefix: read isn't either
--    (attachments_select_active), and re-deriving "may this caller write to
--    this organisation" here would duplicate what record_attachment already
--    checks for the metadata row that actually governs what a CAM sees.
-- ---------------------------------------------------------------------------

create policy attachments_bucket_insert_active on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-attachments'
    and app.can_write()
  );

-- No UPDATE/DELETE policy on storage.objects: replacing or removing an
-- uploaded file isn't in F081's AC (uploading is additive only), so both stay
-- service_role-only.

-- ---------------------------------------------------------------------------
-- 3. record_attachment — the only way an ATTACHMENTS row gets created.
-- ---------------------------------------------------------------------------

create or replace function public.record_attachment(
  p_organisation_id uuid,
  p_filename        text,
  p_storage_path    text,
  p_content_type    text default null,
  p_size_bytes      bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor         uuid := (select auth.uid());
  v_filename      text := btrim(coalesce(p_filename, ''));
  v_org_exists    boolean;
  v_object_exists boolean;
  v_id            uuid;
begin
  if not app.can_write() then
    raise exception 'only a CAM or admin can attach a file' using errcode = '42501';
  end if;

  if v_filename = '' then
    raise exception 'a filename is required' using errcode = '23514';
  end if;

  select exists (select 1 from public.organisations where id = p_organisation_id)
    into v_org_exists;
  if not v_org_exists then
    raise exception 'organisation % not found', p_organisation_id using errcode = 'P0002';
  end if;

  -- Path scheme check (20260823090000_create_attachments.sql header): the
  -- metadata row can only ever point at an object actually stored under this
  -- organisation's prefix, so a caller cannot attribute someone else's
  -- already-uploaded file to the wrong client by supplying a mismatched
  -- organisation_id/storage_path pair.
  if left(p_storage_path, length(p_organisation_id::text) + 1) <> p_organisation_id::text || '/' then
    raise exception 'storage path does not match the organisation' using errcode = '22023';
  end if;

  -- The object must already exist in Storage — this RPC only ever records
  -- metadata for bytes the caller has already uploaded (and that Storage's
  -- own INSERT policy + bucket file_size_limit/allowed_mime_types already
  -- accepted); it never creates the file itself.
  select exists (
    select 1 from storage.objects
     where bucket_id = 'client-attachments' and name = p_storage_path
  ) into v_object_exists;
  if not v_object_exists then
    raise exception 'the uploaded file could not be found in storage' using errcode = 'P0002';
  end if;

  insert into public.attachments
    (organisation_id, filename, storage_path, content_type, size_bytes, uploaded_by)
  values
    (p_organisation_id, v_filename, p_storage_path, p_content_type, p_size_bytes, v_actor)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_attachment(uuid, text, text, text, bigint) is
  'F081: records metadata for a file already uploaded to the client-attachments '
  'bucket. SECURITY DEFINER because ATTACHMENTS grants no INSERT to '
  'authenticated; self-checks app.can_write(), that the organisation exists, '
  'that storage_path is actually under that organisation''s path prefix, and '
  'that the Storage object exists before recording it.';

revoke execute on function public.record_attachment(uuid, text, text, text, bigint)
  from public, anon;
grant execute on function public.record_attachment(uuid, text, text, text, bigint)
  to authenticated;
