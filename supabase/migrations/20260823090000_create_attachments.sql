-- Migration: create_attachments
-- Story: F080 View Client Attachments (#83) + F081 Upload Client Attachment
--   (#84). Built together on this branch because F081 (this branch) has no
--   ancestor migration from F080 to build on — sibling feature branches in
--   this repo don't share unmerged work, so this migration carries both
--   halves rather than pretending a read-only predecessor exists here.
--   F080's own branch adds the read-only half independently; whichever lands
--   in `dev` second reconciles the migration history at merge time.
-- Spec: docs/rls-permission-matrix.md §3.20
--
-- WHAT THIS RESOLVES: F080/F081 both depend on F217 (attachment storage) and
--   F218 (attachment creation) — neither is defined anywhere in the PRD's own
--   feature table (only ever referenced as a dependency) or in this codebase.
--   F081's own "Blocked By: File storage provider" is answered by the PRD's
--   own architecture table (§7: "Supabase Storage | Attachments and future
--   model artifacts") — the question already had an answer, it just hadn't
--   been checked against it.
--
-- SIZE/TYPE LIMITS ARE PROVISIONAL, NOT SIGNED OFF: PRD §14 lists "Attachment
--   size/type limits" as its own open question, owned by "Security + email
--   epic owner", due "before attachment feature release" — a different,
--   narrower question than the storage-provider one this migration answers.
--   The limits below (25 MB; office documents + common images) are a
--   reasonable working default so AC3's "specific error, not a generic
--   failure" has real behaviour to point at, not an authoritative security
--   decision. Kept in exactly one place structurally (the bucket row below is
--   what Storage actually enforces) and mirrored by hand in
--   src/lib/attachments.ts's MAX_ATTACHMENT_SIZE_BYTES /
--   ALLOWED_ATTACHMENT_MIME_TYPES for the client-side fast-path check; that
--   file's comment points back here. Revisit both together when the named
--   owner actually decides.
--
-- BUCKET: `client-attachments`, private (not public) — AC2/AC2-of-F080's
--   open/download is always a short-lived signed URL, never a public bucket
--   path.
--
-- PATH SCHEME: `<organisation_id>/<attachment_id>-<sanitised filename>` —
--   organisation_id leads so record_attachment below can check the path
--   matches the organisation being attached to without a second lookup.
--
-- UPLOAD SHAPE (F081): two steps, not one RPC that takes file bytes — Postgres
--   functions don't receive multipart bodies. The browser uploads the file
--   directly to Storage (client-side, so AC2's loading state reflects the
--   actual transfer, not a proxy through this app's server), which is what
--   the storage.objects INSERT policy and the bucket's file_size_limit /
--   allowed_mime_types below exist to gate; then record_attachment writes the
--   ATTACHMENTS row once Storage confirms the object exists. A failure between
--   the two steps leaves an orphaned Storage object and no metadata row — it
--   simply doesn't appear in anyone's list, and F081's own scope doesn't
--   include a sweep for orphans (nothing currently costs enough to need one).
--
-- WHY SHARED READ, NOT OWNER/ADMIN-SCOPED: same reasoning as NOTES (§3.3) —
--   F019 read-only shared client visibility and this ticket's own
--   "timeline/context visibility" testing note both point at every active
--   role seeing the same attachment list any CAM would. Upload (`can_write()`)
--   is narrower than read, same shape as NOTES' author-write/shared-read spilt
--   but without an author-only edit/delete case: nothing here asks for either.
--
-- Schema change approval record (SOP §7):
--   Change        | New table ATTACHMENTS (not previously reserved in the
--                 | Data Model). New private Storage bucket
--                 | `client-attachments` with file_size_limit and
--                 | allowed_mime_types set; SELECT + INSERT policies on
--                 | storage.objects; record_attachment RPC.
--   Reason        | F080/F081 — closes the "no table, no storage location, no
--                 | write path" gap blocking both.
--   Compatibility | Additive only. No existing table, policy, bucket or query
--                 | changes.
--   Data migration| None.
--   Security      | RLS on ATTACHMENTS: shared SELECT; no direct
--                 | INSERT/UPDATE/DELETE grant — writes go through
--                 | record_attachment, SECURITY DEFINER, self-checks
--                 | app.can_write() and that the referenced Storage object
--                 | actually exists under this organisation's path prefix.
--                 | Storage bucket is private with a real, enforced size cap
--                 | and mime-type allowlist (see provisional-limits note
--                 | above); storage.objects SELECT/INSERT policies both gate
--                 | on app.is_active_user()/app.can_write() respectively, no
--                 | UPDATE/DELETE policy for anyone but service_role.
--   Documentation | Data Model tab 04 (ATTACHMENTS) + tab 02 Data Dictionary +
--                 | tab 11 sequence — still owed against the spreadsheet, same
--                 | as every table added directly by a migration ahead of it.
--
-- Reversibility: paired rollback in
-- ../rollback/20260823090000_create_attachments.down.sql

create table public.attachments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  filename          text not null,
  -- Bucket-relative path (see migration header's path scheme), not a URL — a
  -- URL for a private object is meaningless without a signed token anyway, and
  -- storing the path keeps the signing decision (expiry, who may ask for one)
  -- at request time, in application code, not baked into a stored string.
  storage_path      text not null unique,
  content_type      text,
  size_bytes        bigint,
  uploaded_by       uuid references public.users (id),
  created_at        timestamptz not null default now(),

  constraint attachments_filename_not_blank check (btrim(filename) <> ''),
  constraint attachments_size_non_negative check (size_bytes is null or size_bytes >= 0)
);

comment on table public.attachments is
  'F080/F081: metadata for a file attached to a client. Rows are written only '
  'by record_attachment, after the bytes are already in the client-attachments '
  'Storage bucket at storage_path — see migration header.';
comment on column public.attachments.storage_path is
  'Path within the client-attachments bucket, not a URL. The open/download '
  'link is a short-lived signed URL generated per request, never a stored one.';
comment on column public.attachments.uploaded_by is
  'Nullable: a future non-CAM creation path (e.g. an automated import) may '
  'have no human uploader.';

create index attachments_organisation_id_idx
  on public.attachments (organisation_id, created_at desc);

-- Revoke before grant (MIGRATIONS.md RLS recipe step 1). No INSERT/UPDATE/
-- DELETE grant at all — every write goes through record_attachment below.
revoke all on public.attachments from anon, authenticated;
grant select on public.attachments to authenticated;

alter table public.attachments enable row level security;

-- Shared read, same shape as NOTES (§3.3).
create policy attachments_select_active on public.attachments
  for select to authenticated
  using (app.is_active_user());

-- ---------------------------------------------------------------------------
-- Storage: a private bucket with a real, enforced size/type ceiling, and the
-- two policies that let an upload (F081) and a signed-URL read (F080) succeed.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-attachments', 'client-attachments', false,
  26214400, -- 25 MB — see the provisional-limits note above.
  array[
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
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- createSignedUrl checks RLS on storage.objects the same way a table SELECT
-- does; without this policy every signed-URL request 403s regardless of the
-- ATTACHMENTS row being readable. storage.objects already ships with RLS
-- enabled by the Storage extension itself, so this migration only adds
-- policies, not `enable row level security`.
create policy attachments_bucket_select_active on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-attachments'
    and app.is_active_user()
  );

-- F081: lets the browser's direct-to-Storage upload land at all. The bucket's
-- own file_size_limit/allowed_mime_types above are what actually enforce
-- AC3's size/type ceiling — Storage rejects an over-limit or wrong-type PUT
-- before this policy is even relevant. Not scoped to an organisation path
-- prefix: read isn't either (attachments_select_active, above), and Storage
-- policies re-deriving "is this a real organisation the caller may write to"
-- would duplicate what record_attachment already checks for the metadata row
-- that actually governs what a CAM sees.
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
-- record_attachment — the only way an ATTACHMENTS row gets created.
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

  -- Path scheme check (migration header): the metadata row can only ever
  -- point at an object actually stored under this organisation's prefix, so a
  -- caller cannot attribute someone else's already-uploaded file to the wrong
  -- client by supplying a mismatched organisation_id/storage_path pair.
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
  'that storage_path is actually under that organisation''s prefix, and that '
  'the Storage object exists before recording it.';

revoke execute on function public.record_attachment(uuid, text, text, text, bigint)
  from public, anon;
grant execute on function public.record_attachment(uuid, text, text, text, bigint)
  to authenticated;
